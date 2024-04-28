class Phone {
   constructor() {
      this.isConnected = false;
      this.isAuthenticated = false;
      this.domain;
      this.client = ITooLabs.WebRTC.Factory.getInstance();
      this.getIncomingCall = Function;
      this.updateCall = Function;
      this.calls = {};
   }
   disconnect() {
      this.isConnected = false;
      this.isAuthenticated = false;
   }
   auth({ login, password, token }) {
      this.domain = "hackathon.demo.itoolabs.com";
      // this.domain = location.host;
      return new Promise((resolve, reject) => {
         this.client.removeEventListeners();
         this.client.init({ APIHostName: this.domain });
         this.client
            .addEventListener(ITooLabs.WebRTC.Events.SDKReady, () => {
               this.client.connect();
            })
            .addEventListener(ITooLabs.WebRTC.Events.ConnectionEstablished, () => {
               this.isConnected = true;
               const acc = `${login}@${this.domain}`;
               if (token) {
                  this.client.loginByAuthToken(acc, token);
               } else {
                  this.client.login(acc, password, true);
               }
            })
            .addEventListener(ITooLabs.WebRTC.Events.ConnectionFailed, () => {
               this.disconnect();
               reject();
            })
            .addEventListener(ITooLabs.WebRTC.Events.ConnectionClosed, () => {
               this.disconnect();
            })
            .addEventListener(ITooLabs.WebRTC.Events.AuthResult, (event) => {
               if (event?.result) {
                  this.isAuthenticated = true;
                  if (event.token) {
                     const date = new Date();
                     // время жизни куки authTokenAndUser 30 дней
                     date.setDate(date.getDate() + 30);
                     document.cookie = `authTokenAndUser=${event.token}:${
                        event.user
                     }; expires=${date.toUTCString()}`;
                  }
                  resolve();
               } else {
                  this.client.disconnect(true);
                  reject();
               }
            })
            .addEventListener(ITooLabs.WebRTC.Events.IncomingCall, (event) => {
               if (!event?.call) return;
               this.calls[event.call.leg()] = event.call;
               this.bindCallEventsListener(event.call);
               if (this.getIncomingCall instanceof Function) {
                  this.getIncomingCall({
                     phone: emailUserPart(event.call.number()),
                     leg: event.call.leg(),
                  });
               }
            });
      });
   }
   startCall(phone) {
      if (!this.isAuthenticated) {
         return;
      }
      const call = this.client.call(phone, {});
      this.bindCallEventsListener(call);
      this.calls[call.leg()] = call;
      return call;
   }
   answer(leg) {
      if (this.calls[leg]) {
         this.calls[leg].answer();
      }
   }
   reject(leg) {
      if (this.calls[leg]) {
         if (
            this.calls[leg].state() === ITooLabs.WebRTC.CallState.Connected ||
            this.calls[leg].state() === ITooLabs.WebRTC.CallState.Hold
         ) {
            this.calls[leg].hangup();
         } else {
            if (this.calls[leg].cdr().direction === "in") {
               this.calls[leg].reject();
            } else {
               this.calls[leg].cancel();
            }
         }
      }
   }
   hold(leg) {
      if (this.calls[leg]) {
         this.calls[leg].update();
      }
   }
   sendDtmf(leg, value) {
      if (this.calls[leg]) {
         this.calls[leg].sendDTMF(value);
      }
   }
   transfer(leg, phone) {
      if (this.calls[leg]) {
         this.calls[leg].transfer(phone + "@" + this.domain);
      }
   }
   bindCallEventsListener(call) {
      call.addEventListener(ITooLabs.WebRTC.CallEvents.Connected, () => {
         if (this.updateCall instanceof Function) {
            this.updateCall(call.leg(), "talking");
         }
      });
      call.addEventListener(ITooLabs.WebRTC.CallEvents.Disconnected, () => {
         if (this.updateCall instanceof Function) {
            this.updateCall(call.leg(), "disconnected");
            delete this.calls[call.leg()];
         }
      });
      call.addEventListener(ITooLabs.WebRTC.CallEvents.Failed, () => {
         if (this.updateCall instanceof Function) {
            this.updateCall(call.leg(), "disconnected");
            delete this.calls[call.leg()];
         }
      });
   }
} //Class end

function init() {
   const phone = new Phone();
   console.log(phone);
   const callIntervals = {};
   const canWebRTC =
      DetectRTC.isWebRTCSupported &&
      DetectRTC.hasMicrophone &&
      DetectRTC.isWebsiteHasMicrophonePermissions;
   if (DetectRTC.hasMicrophone && !DetectRTC.isWebsiteHasMicrophonePermissions) {
      navigator.mediaDevices
         .getUserMedia({ audio: true /* video: true*/ })
         .then(function () {
            console.log("Microphone ok");
            showError("");
            $loginBtn.removeClass("disabled");
         })
         .catch(function () {
            console.error("Microphone error");
         });
   }
   let sound;
   try {
      sound = new Audio(getRingtone());
      sound.volume = 0.2;
   } catch (e) {}

   const $callInfo = $("#call-status-info");
   const $callError = $("#call-status-error");

   function getIncomingCall(data) {
      data.direction = "in";
      if (sound) {
         sound.loop = true;
         sound.play();
      }
      addCall(data);
   }
   function updateCall(leg, state) {
      setCallStatus(leg, state);
   }
   function stopSound() {
      if (sound) {
         sound.pause();
         sound.currentTime = 0;
      }
   }
   phone.getIncomingCall = getIncomingCall;
   phone.updateCall = updateCall;

   const $login = $("#login").hide();
   const $loginName = $("#login-name").hide();
   const $loginBtn = $("#login-btn").click((evt) => {
      if ($(evt.target).hasClass("disabled")) {
         return;
      }
      $login.toggle(); //jquery переключение видимости
   });
   const $dial = $("#dial-numbers").hide();
   const $callsList = $("#calls-list").hide();
   const $phoneInput = $("#number-input input");
   const $loginInput = $("#login-input");
   const $passwordInput = $("#password-input");
   $phoneInput.keyup(() => {
      $phoneInput.removeClass("error");
   });
   $loginInput.keyup(() => {
      $loginInput.removeClass("error");
      $passwordInput.removeClass("error");
   });
   $passwordInput.keyup(() => {
      $loginInput.removeClass("error");
      $passwordInput.removeClass("error");
   });

   $("#auth").click(() => {
      const login = $loginInput.val();
      const password = $passwordInput.val();
      if (login && password) {
         phone
            .auth({ login, password })
            .then(() => {
               $login.hide();
               $loginBtn.hide();
               $loginName.show().text(login);
               setPhoneStatus("idle");
               $callsList.show();
               showError("");
            })
            .catch(() => {
               showError("Error authentication");
            });
      } else {
         $loginInput.addClass("error");
         $passwordInput.addClass("error");
      }
   });

   const $startCallBtn = $("#call-btn");
   const $transferBtn = $("#transfer-btn");

   setPhoneStatus("logout");

   function getCookie(name) {
      const matches = document.cookie.match(
         new RegExp(
            "(?:^|; )" +
               name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, "\\$1") +
               "=([^;]*)"
         )
      );
      return matches ? decodeURIComponent(matches[1]) : undefined;
   }

   const authTokenAndUser = getCookie("authTokenAndUser");
   if (authTokenAndUser) {
      const [token, login] = authTokenAndUser.split(":");
      phone.auth({ login, token }).then(() => {
         $login.hide();
         $loginBtn.hide();
         $loginName.show().text(login);
         setPhoneStatus("idle");
         $callsList.show();
         if (!canWebRTC) {
            showError("Can't use WebRTC");
            $startCallBtn.addClass("disabled");
         } else {
            showError("");
         }
      });
   }

   if (!canWebRTC) {
      showError("Can't use WebRTC");
      $loginBtn.addClass("disabled");
      return;
   }

   $startCallBtn.click((evt) => {
      if ($(evt.target).hasClass("disabled")) {
         return;
      }
      const phoneValue = $phoneInput.val();
      if (phoneValue) {
         const call = phone.startCall(phoneValue);
         addCall({
            phone: phoneValue,
            direction: "out",
            leg: call.leg(),
         });
      } else {
         $phoneInput.addClass("error");
      }
   });
   $(".num-value").click((evt) => {
      const num = $(evt.target).text();
      const leg = $(evt.target).parent().parent().data("leg");
      phone.sendDtmf(leg, num);
   });

   function showError(text) {
      $callInfo.text("");
      $callError.text(text);
   }

   function addCall(data) {
      let status;
      if (data.direction === "in") {
         status = `Incoming call...`;
      } else {
         status = `Calling...`;
      }
      const $call = $(
         `<div class='call' data-leg='${data.leg}'>` +
            `<div class='call-header'><span>${data.phone}</span><span class='call-hold'>(hold)</span></div>` +
            `<div class='call-status'>${status}</div>` +
            `<div class='call-time'></div>` +
            "<div class='call-buttons'>" +
            "<div class='button accept'>Accept</div>" +
            "<div class='button hold'>Hold</div>" +
            "<div class='button dial'>Dial</div>" +
            "<div class='button transfer'>Transfer</div>" +
            "<div class='button reject'>Reject</div>" +
            "</div>" +
            "</div>"
      );
      $call.find(".button.accept").click((event) => {
         const leg = $(event.target).parent().parent().data("leg");
         phone.answer(leg);
      });
      $call.find(".button.reject").click((event) => {
         const leg = $(event.target).parent().parent().data("leg");
         phone.reject(leg);
      });
      $call
         .find(".button.transfer")
         .click((event) => {
            const leg = $(event.target).parent().parent().data("leg");
            const phoneValue = $phoneInput.val();
            if (phoneValue) {
               phone.transfer(leg, phoneValue);
            }
         })
         .hide();
      $call
         .find(".button.hold")
         .click((event) => {
            const leg = $(event.target).parent().parent().data("leg");
            phone.hold(leg);
            $call.toggleClass("hold");
         })
         .hide();
      $call
         .find(".button.dial")
         .click((event) => {
            const leg = $(event.target).parent().parent().data("leg");
            if ($dial.is(":visible")) {
               const dialLeg = $dial.attr("data-leg");
               if (dialLeg === leg) {
                  $dial.hide();
               } else {
                  $dial.attr("data-leg", leg);
               }
            } else {
               $dial.attr("data-leg", leg).show();
            }
         })
         .hide();
      if (data.direction === "out") {
         $call.find(".button.accept").hide();
      }
      $callsList.append($call);
   }

   function setCallStatus(leg, status) {
      const $call = $callsList.find(`.call[data-leg=${leg}]`);
      if (!$call.length) {
         return;
      }
      switch (status) {
         case "talking":
            stopSound();
            $call.find(".call-status").text("00:00");
            $call.find(".button.accept").hide();
            $call.find(".button.hold").show();
            $call.find(".button.dial").show();
            $call.find(".button.transfer").show();
            $call.find(".call-time").text(new Date().getTime());
            callIntervals[leg] = setInterval(() => {
               const start = Number($call.find(".call-time").text());
               const diff = new Date(new Date().getTime() - start);
               $call
                  .find(".call-status")
                  .text(
                     `${addLeadZero(diff.getMinutes())}:${addLeadZero(
                        diff.getSeconds()
                     )}`
                  );
            }, 1000);
            break;
         case "disconnected":
            stopSound();
            $call.remove();
            if ($dial.is(":visible") && $dial.attr("data-leg") === leg) {
               $dial.hide();
            }
            clearInterval(callIntervals[leg]);
            break;
      }
   }

   function setPhoneStatus(status) {
      switch (status) {
         case "idle":
            $startCallBtn.removeClass("disabled");
            $transferBtn.addClass("disabled");
            break;
         case "logout":
            $startCallBtn.addClass("disabled");
            $transferBtn.addClass("disabled");
            break;
      }
   }
}
//ЗАПУСК ВСЕГО ПРОЕКТА
$(document).ready(() => {
   DetectRTC.load(() => init());
});

function emailUserPart(email) {
   if (!email) return "";
   var idx = email.indexOf("@");
   if (idx < 0) return email;
   return email.substring(0, idx);
}

function addLeadZero(val) {
   return (val > 9 ? "" : "0") + val;
}

function getRingtone() {
   return "data:audio/wav;base64,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RO0pgSwK4pQsZOAIVvpTQlLDHrsWgUWta+xL3Lnz4efHn2gAcOUwYCsggCiLbV9oBCjDChcYvRm9ayeZl7EB6OMYqSyUVMJvsiKtQRouMnDXWnX62dT6DJqMJdSZaSKaSKU+/jH/+7/7f//6v/+v6yoVFLNEQJAkTR1Knaa8/0bVKnqZ8HczQmlLGa9D2b6u0/VICVHFCaz/UcphqHpd3cpjNLjvGlpccfrU1LShIGgag0DQVBUGoKho8JQVcIgVcIgag0DT1g1KnYlBWWDUsHZYGnrI/xECvlj0qDQNHtYKu/pCwAC1LQwEBM1AQFWvrWy9VrLJOihChDi5AaDRM1aIiAEbFKFCk0qCp3iIGuHZU9U/xQl/KiJ//8RPkcq6Jf1nf/5V3waqTEFNRTMuOTkuNaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSZPAAA/UvxcmaYmBIZHjqGxBKDmhxFATjCUEUCWMcN6TgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk5LjWqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=";
}
