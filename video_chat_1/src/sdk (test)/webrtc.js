(function (itl) {
   var RTCPeerConnection =
      window.RTCPeerConnection || window.webkitRTCPeerConnection;
   var RTCSessionDescription =
      window.RTCSessionDescription || window.webkitRTCSessionDescription;
   navigator.getUserMedia =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia;

   var __attach = function (element, type, fn) {
      if (element.addEventListener) {
         element.addEventListener(type, fn, false);
      } else if (element.attachEvent) {
         element.attachEvent("on" + type, fn);
      }
   };

   itl.extend = function (obj, src) {
      for (var key in src) {
         if (src.hasOwnProperty(key)) obj[key] = src[key];
      }
      return obj;
   };

   itl.WebRTC = {};

   /*
    *  listeners: onConnected, onDisconnected, onConnetionFailed, onMessage
    * */
   itl.WebRTC.APIConnection = function (url, hello, debug) {
      var conn,
         _listeners = {},
         seq = 0,
         ack = 0,
         lastSentAck = 0,
         sid,
         reqSeq = 0,
         reqCallbacks = {},
         unackedMessages,
         onrequest,
         noopTimeout = null,
         dispatchEvent = function (e, d) {
            if (_listeners[e]) {
               for (var i = 0; i < _listeners[e].length; i++) {
                  if (_listeners[e][i] && _listeners[e][i].push) {
                     var h = _listeners[e][i][0],
                        cond = _listeners[e][i][1];
                     if (typeof h == "function") {
                        if (cond) {
                           var k = cond.key,
                              v = cond.value,
                              c = cond.condition;

                           if (c == "eq") {
                              if (d && d[k] == v) {
                                 h.call(null, d);
                              }
                           }
                        } else {
                           h.call(null, d);
                        }
                     }
                  } else {
                     if (typeof _listeners[e][i] == "function") {
                        _listeners[e][i].call(null, d);
                     }
                  }
               }
            }
         },
         removeAcked = function (ack) {
            if (unackedMessages && unackedMessages.length > 0) {
               if (unackedMessages[unackedMessages.length - 1].seq <= ack) {
                  unackedMessages = undefined;
               } else {
                  while (
                     unackedMessages.length > 0 &&
                     unackedMessages[0].seq <= ack
                  ) {
                     unackedMessages.shift();
                  }
               }
            }
         },
         send = function (m) {
            var s = JSON.stringify(m);
            if (debug) {
               debug.call(null, "out", m);
            }
            if (noopTimeout) {
               clearTimeout(noopTimeout);
               noopTimeout = null;
            }
            conn.send(s);
            noopTimeout = setTimeout(function () {
               sendMessage({ "": "noop" });
            }, 60000);
         },
         onOpen = function (event) {
            var h;
            if (sid) {
               h = {
                  sid: sid,
                  ack: ack,
               };
               if (unackedMessages && unackedMessages.length > 0) {
                  h.seq = unackedMessages[0].seq;
                  var payloads = [];
                  for (var i = 0; i < unackedMessages.length; i++) {
                     payloads.push(unackedMessages[i].payload);
                  }
                  h.payloads = payloads;
               }
            } else {
               h = hello || {
                  task: "Main",
                  useragent: window.navigator.userAgent,
                  params: {
                     apiVersion: 1,
                     platform: window.navigator.platform,
                     appId: "WebRTC",
                  },
               };
            }
            conn = event.target;
            send(h);
         },
         onClose = function (event) {
            if (noopTimeout) {
               clearTimeout(noopTimeout);
               noopTimeout = null;
            }
            if (conn) {
               conn = null;
               seq = 0;
               ack = 0;
               lastSentAck = 0;
               sid = null;
               unackedMessages = null;
               dispatchEvent("onDisconnected", event);
            } else {
               dispatchEvent("onConnectionFailed", event);
            }
         },
         receivePayload = function (d) {
            removeAcked(d.ack);
            if (d.payloads) {
               var curSeq = d.seq;
               for (var i = 0; i < d.payloads.length; i++) {
                  if (curSeq > ack) {
                     ack = curSeq;
                     curSeq++;
                     processPayload(d.payloads[i]);
                  }
               }
            } else {
               if (d.seq > ack) {
                  ack = d.seq;
                  if (d.payload) {
                     processPayload(d.payload);
                  }
               }
            }
            if (ack - lastSentAck > 4) {
               send({ ack: ack });
               lastSentAck = ack;
            }
         },
         processPayload = function (p) {
            if (!p) return;
            switch (p.What) {
               case "request":
                  if (onrequest) {
                     var resp = onrequest(p[""]);
                     sendMessage({ What: "response", id: p.id, "": resp });
                  }
                  break;
               case "response":
                  if (p.id != null) {
                     var cb = reqCallbacks[p.id];
                     if (cb) {
                        cb(p[""]);
                        delete reqCallbacks[p.id];
                     }
                  }
                  break;
               default:
                  dispatchEvent("onMessage", p);
            }
         },
         handleMessage = function (event) {
            var d = JSON.parse(event.data);
            if (debug) {
               debug.call(null, "in", d);
            }
            if (d.bye) {
               conn = null;
               seq = 0;
               ack = 0;
               lastSentAck = 0;
               sid = null;
               unackedMessages = null;
               dispatchEvent("onDisconnected");
            } else {
               receivePayload(d);
            }
         },
         handleHelloResponse = function (event) {
            try {
               var d = JSON.parse(event.data);
               if (debug) {
                  debug.call(null, "in", d);
               }
               if (d.status === "ok") {
                  if (d.sid) {
                     sid = d.sid;
                     dispatchEvent("onConnected");
                  } else {
                     receivePayload(d);
                  }
                  conn.onmessage = handleMessage;
               }
            } catch (e) {
               console.error("JSON parse error: " + e.message);
            }
         },
         connect = function () {
            if (!conn) {
               var c = new WebSocket(url);
               c.onopen = onOpen;
               c.onmessage = handleHelloResponse;
               c.onclose = onClose;
            }
            return this;
         },
         sendMessage = function (payload) {
            if (!conn) return;
            seq++;
            var m = {
               seq: seq,
               ack: ack,
               payload: payload,
            };
            lastSentAck = ack;
            if (unackedMessages) {
               unackedMessages.push(m);
            } else {
               unackedMessages = [m];
            }
            send(m);
            return this;
         },
         sendRequest = function (request, callback) {
            if (typeof callback === "function") {
               var reqId = reqSeq++;
               var payload = { What: "request", id: reqId, "": request };
               reqCallbacks[reqId] = callback;
               sendMessage(payload);
            } else {
               sendMessage(request);
            }
         },
         disconnect = function () {
            if (!conn) return;
            conn.close();
            return this;
         },
         addListener = function (event, handler, condition) {
            if (!_listeners[event]) _listeners[event] = [];
            _listeners[event].push(condition ? [handler, condition] : handler);
            return this;
         },
         removeListener = function (event, handler) {
            if (!_listeners || !_listeners[event] || !_listeners[event].length)
               return;

            for (var i = _listeners[event].length - 1; i >= 0; i--) {
               if (_listeners[event][i] && _listeners[event][i].push) {
                  if (_listeners[event][i][0] == handler) {
                     _listeners[event].splice(i, 1);
                  }
               } else {
                  if (_listeners[event][i] == handler) {
                     _listeners[event].splice(i, 1);
                  }
               }
            }
            return this;
         };

      return {
         addListener: addListener,
         removeListener: removeListener,
         connect: connect,
         disconnect: disconnect,
         sendMessage: sendMessage,
         sendRequest: sendRequest,
      };
   };

   let _mediaStream;
   const _getUserMedia = () => {
      return new Promise((resolve, reject) => {
         if (_mediaStream) {
            resolve(_mediaStream);
            return;
         }
         try {
            navigator.mediaDevices
               .getUserMedia({ audio: true, video: true })
               .then((stream) => {
                  _mediaStream = stream;
                  resolve(stream);
               })
               .catch((e) => {
                  reject(e);
               });
         } catch (e) {
            reject(e);
         }
      });
   };

   itl.WebRTC.CallCounter = 0;

   itl.WebRTC.Call = function (
      call,
      num,
      dn,
      hdrs,
      conn,
      noDial,
      audioCodecPriority
   ) {
      var _this,
         _listeners = {},
         _leg,
         _active = false,
         _state,
         _onMessageHandler,
         _dtmfSender,
         _pc,
         _remoteAudio,
         _localAudio,
         _micMuted = false,
         _playbackMuted = false,
         _cdr = {
            callId: null,
            direction: null,
            num: null,
            dn: null,
            diversion: null,
            callback: null,
            hdrs: null,
            start: null,
            stop: null,
            disconnectCode: null,
            disconnectReason: null,
            uuid: null,
         },
         /** @ignore */
         dispatchEvent = function (e) {
            var event = e.name;
            if (_listeners[event]) {
               for (var i = 0; i < _listeners[event].length; i++) {
                  if (typeof _listeners[event][i] == "function") {
                     _listeners[event][i].call(null, e);
                  }
               }
            }
         },
         /** @ignore */
         init = function () {
            _onMessageHandler = function (msg) {
               if (msg) {
                  switch (msg.What) {
                     case "provisioned":
                        if (_state === itl.WebRTC.CallState.Dial) {
                           _state = itl.WebRTC.CallState.Provisioned;
                           if (msg.sdp) {
                              _pc.setRemoteDescription(
                                 new RTCSessionDescription({
                                    type: "answer",
                                    sdp: msg.sdp,
                                 }),
                                 function () {
                                    dispatchEvent({
                                       name: itl.WebRTC.CallEvents.Provisioned,
                                       call: _this,
                                    });
                                 },
                                 function (e) {
                                    disconnectErrorCall(e);
                                 }
                              );
                           } else {
                              dispatchEvent({
                                 name: itl.WebRTC.CallEvents.Provisioned,
                                 call: _this,
                              });
                           }
                        }
                        break;
                     case "accepted":
                        if (msg.sdp) {
                           if (_pc.signalingState === "stable") {
                              ackAccept();
                           } else {
                              _pc.setRemoteDescription(
                                 new RTCSessionDescription({
                                    type: "answer",
                                    sdp: msg.sdp,
                                 }),
                                 function () {
                                    ackAccept();
                                 },
                                 function (e) {
                                    disconnectErrorCall(e);
                                 }
                              );
                           }
                        }
                        break;
                     case "acceptAcked":
                        _active = true;
                        _cdr.start = new Date();
                        _state = itl.WebRTC.CallState.Connected;
                        dispatchEvent({
                           name: itl.WebRTC.CallEvents.Connected,
                           call: _this,
                        });
                        break;
                     case "updated":
                        if (msg.sdp) {
                           if (typeof msg.sdp == "string") {
                              msg.sdp = msg.sdp.replace(
                                 "setup:active",
                                 "setup:actpass"
                              );
                           }
                           _pc.setRemoteDescription(
                              new RTCSessionDescription({
                                 type: "offer",
                                 sdp: msg.sdp,
                              }),
                              function () {
                                 _pc.createAnswer(function (answer) {
                                    _pc.setLocalDescription(answer);
                                    conn.sendRequest({
                                       "": "AcceptUpdate",
                                       leg: _leg,
                                       sdp: answer.sdp,
                                    });
                                 }, error);
                              },
                              function (e) {
                                 disconnectErrorCall(e);
                              }
                           );
                        } else {
                           _pc.createOffer(
                              function (offer) {
                                 _pc.setLocalDescription(
                                    new RTCSessionDescription(offer),
                                    function () {
                                       conn.sendRequest({
                                          "": "AcceptUpdate",
                                          leg: _leg,
                                          addr: _cdr.num,
                                          sdp: offer.sdp,
                                       });
                                    },
                                    error
                                 );
                              },
                              function (e) {
                                 disconnectErrorCall(e);
                              },
                              {}
                           );
                        }
                        break;
                     case "updateAcked":
                        if (msg.sdp) {
                           if (
                              _cdr.direction === "in" &&
                              typeof msg.sdp == "string"
                           ) {
                              msg.sdp = msg.sdp.replace(
                                 "setup:actpass",
                                 "setup:passive"
                              );
                           }
                           _pc.setRemoteDescription(
                              new RTCSessionDescription({
                                 type: "answer",
                                 sdp: msg.sdp,
                              }),
                              function () {},
                              function (e) {
                                 disconnectErrorCall(e);
                              }
                           );
                        }
                        break;
                     case "updateAccepted":
                        if (msg.sdp) {
                           if (
                              _cdr.direction === "in" &&
                              typeof msg.sdp == "string"
                           ) {
                              msg.sdp = msg.sdp.replace(
                                 "setup:actpass",
                                 "setup:passive"
                              );
                           }
                           _pc.setRemoteDescription(
                              new RTCSessionDescription({
                                 type: "answer",
                                 sdp: msg.sdp,
                              }),
                              function () {
                                 if (_state === itl.WebRTC.CallState.Connected) {
                                    _state = itl.WebRTC.CallState.Hold;
                                 } else if (_state === itl.WebRTC.CallState.Hold) {
                                    _state = itl.WebRTC.CallState.Connected;
                                 }
                              },
                              function (e) {
                                 disconnectErrorCall(e);
                              }
                           );
                        } else {
                           if (_state === itl.WebRTC.CallState.Connected) {
                              _state = itl.WebRTC.CallState.Hold;
                           } else if (_state === itl.WebRTC.CallState.Hold) {
                              _state = itl.WebRTC.CallState.Connected;
                           }
                        }
                        break;
                     case "updateRejected":
                        break;
                     case "cancelled":
                        cleanupCall(msg.code, msg.reason);
                        break;
                     case "terminated":
                        cleanupCall(msg.code, msg.reason);
                        break;
                     case "rejected":
                        cleanupCall(msg.code, msg.reason);
                        break;
                  }
               }
            };

            _state = itl.WebRTC.CallState.Initialized;

            if (call) {
               _cdr.direction = "in";
               _leg = call.leg;
               if (call.dest) {
                  if (
                     call.dest["From"] &&
                     typeof call.dest["From"][""] === "string"
                  ) {
                     _cdr.num = call.dest["From"][""];
                  } else if (
                     call.dest["From"] &&
                     typeof call.dest["From"][""] === "object" &&
                     call.dest["From"][""][""]
                  ) {
                     _cdr.num = call.dest["From"][""][""];
                  }
                  _cdr.dn = call.dest["From"] ? call.dest["From"]["@realName"] : "";
                  _cdr.callId = call.dest["Call-ID"];
                  if (
                     Array.isArray(call.dest["X-UUID"]) &&
                     call.dest["X-UUID"].length &&
                     call.dest["X-UUID"][0].length > 1
                  ) {
                     _cdr.uuid = call.dest["X-UUID"][0];
                  } else if (call.dest["X-UUID"]) {
                     _cdr.uuid = call.dest["X-UUID"];
                  }
                  if (
                     call.dest["Diversion"] instanceof Array &&
                     call.dest["Diversion"].length > 0 &&
                     call.dest["Diversion"][0][""]
                  ) {
                     _cdr.diversion = call.dest["Diversion"][0][""];
                  }
                  if (call.dest["x-callback"]) {
                     _cdr.callback = call.dest["x-callback"];
                  }
               }
               conn.addListener("onMessage", _onMessageHandler, {
                  key: "leg",
                  value: _leg,
                  condition: "eq",
               });
            } else {
               _cdr.direction = "out";
               _leg = "out" + ++itl.WebRTC.CallCounter;
               _cdr.num = num;
               _cdr.dn = dn;
               _cdr.hdrs = hdrs;
               if (!noDial) dial();
            }
         },
         /** @ignore */
         cleanupCall = function (code, reason, stack) {
            if (_state == itl.WebRTC.CallState.Disconnected) return;
            if (_localAudio) {
               _localAudio.pause();
               _localAudio.src = "";
            }
            if (_remoteAudio) {
               _remoteAudio.pause();
               _remoteAudio.src = "";
            }
            if (_pc) _pc.close();
            _state = itl.WebRTC.CallState.Disconnected;
            _cdr.disconnectCode = code;
            _cdr.disconnectReason = reason;
            _cdr.stop = new Date();
            dispatchEvent({ name: itl.WebRTC.CallEvents.Disconnected, call: _this });
            if (stack) {
               trace(code, reason, stack);
            }
         },
         trace = function (code, reason, stack) {
            var msg = {
               "": "trace",
               code: code,
               reason: reason,
               userAgent: navigator.userAgent,
            };
            if (stack) msg.stack = stack;
            conn.sendRequest(msg);
         },
         ackAccept = function () {
            conn.sendMessage({
               "": "AckAccept",
               leg: _leg,
            });
            _active = true;
            _cdr.start = new Date();
            _state = itl.WebRTC.CallState.Connected;
            dispatchEvent({ name: itl.WebRTC.CallEvents.Connected, call: _this });
         },
         disconnectErrorCall = function (e) {
            conn.sendRequest({
               "": "DisconnectCall",
               leg: _leg,
               code: 500,
            });
            error(e);
         },
         /** @ignore */
         error = function (e) {
            var msg;
            if (typeof e.Error === "function") {
               msg = e.Error();
            } else if (typeof e.message === "string") {
               msg = e.message;
            } else {
               msg = JSON.stringify(e);
            }
            console.log("Got some error ", msg);
            var stack = e.stack;
            if (!stack && e && e.message) {
               stack = e.message;
            }
            cleanupCall(500, "Internal server error", stack);
         },
         /** @ignore */
         enableDtmfSender = function (stream) {
            if (_pc.getSenders) {
               var senders = _pc.getSenders();
               var audioSender = senders.find(
                  (sender) => sender.track && sender.track.kind === "audio"
               );
               if (audioSender && audioSender.dtmf) {
                  _dtmfSender = audioSender.dtmf;
               }
            } else {
               if (stream !== null) {
                  var localAudioTrack = stream.getAudioTracks()[0];
                  if (_pc.createDTMFSender) {
                     _dtmfSender = _pc.createDTMFSender(localAudioTrack);
                  }
               }
            }
            if (_dtmfSender) {
               _dtmfSender.ontonechange = dtmfOnToneChange;
            }
         },
         /** @ignore */
         dtmfOnToneChange = function (tone) {
            if (tone) {
               console.log("Sent DTMF tone: " + tone.tone);
            }
         },
         /** @ignore */
         sendTones = function (tones) {
            if (_dtmfSender) {
               try {
                  _dtmfSender.insertDTMF(tones, 500);
               } catch (e) {
                  if (e.stack) {
                     trace(500, "insertDTMF error", e.stack);
                  }
               }
            } else {
               trace(500, "insertDTMF error", "_dtmfSender not initialize");
            }
         },
         id = function () {
            return _leg;
         },
         callId = function () {
            return _cdr.callId;
         },
         uuid = function () {
            return _cdr.uuid;
         },
         active = function () {
            return _active;
         },
         setActive = function (a) {
            _active = !!a;
            return _this;
         },
         state = function () {
            return _state;
         },
         displayName = function () {
            return dn;
         },
         diversion = function () {
            return _cdr.diversion;
         },
         number = function () {
            return _cdr.num;
         },
         getCallback = function () {
            return _cdr.callback;
         },
         headers = function () {
            return hdrs;
         },
         cdr = function () {
            return _cdr;
         },
         dial = function () {
            if (_cdr.direction == "out") {
               _pc = new RTCPeerConnection(
                  {
                     iceServers: [
                        {
                           urls: ["stun:stun.services.mozilla.com"],
                           username: "louis@mozilla.com",
                           credential: "webrtcdemo",
                        },
                     ],
                  },
                  { mandatory: { DtlsSrtpKeyAgreement: "true" } }
               );
               _pc.ontrack = function (obj) {
                  _remoteAudio = document.createElement("audio");
                  _remoteAudio.id = "itl_webrtc_ra_" + _leg;
                  _remoteAudio.autoplay = true;
                  _remoteAudio.style.display = "none";
                  if (document.body.firstChild)
                     document.body.insertBefore(
                        _remoteAudio,
                        document.body.firstChild
                     );
                  else document.body.appendChild(_remoteAudio);
                  _remoteAudio.srcObject = obj.streams[0];
               };

               _getUserMedia()
                  .then((stream) => {
                     _localAudio = document.createElement("audio");
                     _localAudio.id = "itl_webrtc_la_" + _leg;
                     _localAudio.autoplay = false;
                     _localAudio.style.display = "none";
                     if (document.body.firstChild)
                        document.body.insertBefore(
                           _localAudio,
                           document.body.firstChild
                        );
                     else document.body.appendChild(_localAudio);
                     _localAudio.srcObject = stream;

                     _pc.addStream(stream);

                     enableDtmfSender(stream);

                     if (
                        Array.isArray(audioCodecPriority) &&
                        audioCodecPriority.length
                     ) {
                        const transceivers = _pc.getTransceivers();
                        transceivers.forEach((transceiver) => {
                           try {
                              const availableCodecs =
                                 RTCRtpSender.getCapabilities("audio").codecs;
                              let codecs = [];
                              audioCodecPriority.forEach((codecName) => {
                                 const findCodecs = availableCodecs.filter(
                                    (codecData) =>
                                       codecData.mimeType === `audio/${codecName}`
                                 );
                                 if (findCodecs.length) {
                                    codecs = [...codecs, ...findCodecs];
                                 }
                              });
                              if (codecs.length)
                                 transceiver.setCodecPreferences(codecs);
                           } catch (e) {}
                        });
                     }
                     _pc.createOffer(
                        function (offer) {
                           _pc.setLocalDescription(
                              new RTCSessionDescription(offer),
                              function () {
                                 // send the offer to a server to be forwarded to the friend you're calling.
                                 conn.addListener("onMessage", _onMessageHandler, {
                                    key: "leg",
                                    value: _leg,
                                    condition: "eq",
                                 });
                                 conn.sendRequest(
                                    {
                                       "": "StartCall",
                                       leg: _leg,
                                       addr: itl.extend({ "": num }, hdrs || {}),
                                       sdp: offer.sdp,
                                    },
                                    function (rs) {
                                       _active = true;
                                       _state = itl.WebRTC.CallState.Dial;
                                       if (rs) {
                                          cleanupCall(500, "Internal server error");
                                       }
                                    }
                                 );
                              },
                              error
                           );
                        },
                        error,
                        {}
                     );
                  })
                  .catch((e) => {
                     error(e);
                  });
            }
            return _this;
         },
         answer = function () {
            _getUserMedia()
               .then((stream) => {
                  _pc = new RTCPeerConnection({
                     iceServers: [
                        {
                           urls: "stun:stun.services.mozilla.com",
                           username: "louis@mozilla.com",
                           credential: "webrtcdemo",
                        },
                     ],
                  });
                  _pc.ontrack = function (obj) {
                     _remoteAudio = document.createElement("audio");
                     _remoteAudio.id = "itl_webrtc_ra_" + _leg;
                     _remoteAudio.autoplay = true;
                     _remoteAudio.style.display = "none";
                     if (document.body.firstChild)
                        document.body.insertBefore(
                           _remoteAudio,
                           document.body.firstChild
                        );
                     else document.body.appendChild(_remoteAudio);
                     _remoteAudio.srcObject = obj.streams[0];
                  };

                  _localAudio = document.createElement("audio");
                  _localAudio.id = "itl_webrtc_la_" + _leg;
                  _localAudio.autoplay = false;
                  _localAudio.style.display = "none";
                  if (document.body.firstChild)
                     document.body.insertBefore(
                        _localAudio,
                        document.body.firstChild
                     );
                  else document.body.appendChild(_localAudio);
                  _localAudio.srcObject = stream;

                  _pc.addStream(stream);

                  enableDtmfSender(stream);

                  _pc.setRemoteDescription(
                     new RTCSessionDescription({ type: "offer", sdp: call.sdp }),
                     function () {
                        _pc.createAnswer(function (answer) {
                           _pc.setLocalDescription(answer);
                           conn.sendRequest(
                              {
                                 "": "AcceptCall",
                                 leg: _leg,
                                 sdp: answer.sdp,
                              },
                              function (rs) {
                                 if (rs) {
                                    cleanupCall(500, "Internal server error");
                                 }
                              }
                           );
                        }, error);
                     },
                     function (e) {
                        conn.sendRequest({
                           "": "DisconnectCall",
                           leg: _leg,
                           code: 500,
                        });
                        error(e);
                     }
                  );
               })
               .catch((e) => {
                  error(e);
               });
            return _this;
         },
         decline = function () {
            conn.sendRequest(
               {
                  "": "RejectCall",
                  code: 603,
                  leg: _leg,
               },
               function (rs) {
                  if (rs) {
                     cleanupCall(500, "Internal server error");
                  } else {
                     cleanupCall(603, "Decline");
                  }
               }
            );
            return _this;
         },
         hangup = function () {
            if (_state != itl.WebRTC.CallState.Disconnected) {
               conn.sendRequest(
                  {
                     "": "DisconnectCall",
                     code: 200,
                     reason: "OK",
                     leg: _leg,
                  },
                  function (rs) {
                     if (rs) {
                        cleanupCall(500, "Internal server error");
                     } else {
                        cleanupCall(200, "OK");
                     }
                  }
               );
            }
            return _this;
         },
         cancel = function () {
            conn.sendRequest(
               {
                  "": "CancelCall",
                  code: 486,
                  reason: "Busy Here",
                  leg: _leg,
               },
               function (rs) {
                  if (rs) {
                     cleanupCall(500, "Internal server error");
                  } else {
                     cleanupCall(486, "Busy Here");
                  }
               }
            );
            return _this;
         },
         reject = function () {
            conn.sendRequest(
               {
                  "": "RejectCall",
                  code: 486,
                  reason: "Busy Here",
                  leg: _leg,
               },
               function (rs) {
                  if (rs) {
                     cleanupCall(500, "Internal server error");
                  } else {
                     cleanupCall(486, "Busy Here");
                  }
               }
            );

            return _this;
         },
         provision = function () {
            conn.sendRequest(
               {
                  "": "ProvisionCall",
                  leg: _leg,
               },
               function (rs) {
                  if (!rs) {
                     _this._state = ITooLabs.WebRTC.CallState.Provisioned;
                  }
               }
            );

            return _this;
         },
         transfer = function (address, leg) {
            var req = {
               "": "Transfer",
               leg: _leg,
            };
            if (leg) {
               req.targetLeg = leg;
            } else {
               req.address = address;
            }
            conn.sendRequest(req, function (rs) {
               if (rs) {
                  cleanupCall(500, "Internal server error");
               } else {
                  cleanupCall(200, "OK");
               }
            });

            return _this;
         },
         update = function () {
            _pc.createOffer(
               function (offer) {
                  if (_state === itl.WebRTC.CallState.Connected) {
                     offer.sdp = offer.sdp.replace(/a=sendrecv/g, "a=sendonly");
                     offer.sdp = offer.sdp.replace(/a=recvonly/g, "a=inactive");
                  } else {
                     offer.sdp = offer.sdp.replace(/a=sendonly/g, "a=sendrecv");
                     offer.sdp = offer.sdp.replace(/a=inactive/g, "a=recvonly");
                  }
                  _pc.setLocalDescription(
                     new RTCSessionDescription(offer),
                     function () {
                        conn.sendRequest(
                           {
                              "": "UpdateCall",
                              leg: _leg,
                              sdp: offer.sdp,
                           },
                           function (rs) {
                              if (rs) {
                                 disconnectErrorCall(rs);
                              }
                           }
                        );
                     },
                     function (e) {
                        disconnectErrorCall(e);
                     }
                  );
               },
               function (e) {
                  disconnectErrorCall(e);
               }
            );
         },
         sendTone = function (n) {
            sendTones(n);
            return _this;
         },
         muteMicrophone = function () {
            if (!_micMuted) {
               if (_pc?.getSenders) {
                  _pc.getSenders().forEach((sender) => {
                     if (sender.track) {
                        sender.track.enabled = false;
                     } else {
                        sender.track = { enabled: false };
                     }
                  });
               }
               _micMuted = true;
            }
            return _this;
         },
         unmuteMicrophone = function () {
            if (_micMuted) {
               if (_pc?.getSenders) {
                  _pc.getSenders().forEach((sender) => {
                     if (sender.track) {
                        sender.track.enabled = true;
                     } else {
                        sender.track = { enabled: true };
                     }
                  });
               }
               _micMuted = false;
            }
            return _this;
         },
         isMicrophoneMuted = function () {
            return _micMuted;
         },
         mutePlayback = function () {
            if (!_playbackMuted) {
               document.querySelector("audio").muted = true;
               _playbackMuted = true;
            }
            return _this;
         },
         unmutePlayback = function () {
            if (_playbackMuted) {
               document.querySelector("audio").muted = false;
               _playbackMuted = false;
            }
            return _this;
         },
         isPlaybackMuted = function () {
            return _playbackMuted;
         },
         addEventListener = function (event, handler) {
            if (!_listeners[event]) _listeners[event] = [];
            _listeners[event].push(handler);
            return _this;
         },
         removeEventListener = function (event, handler) {
            if (!_listeners || !_listeners[event] || !_listeners[event].length)
               return;

            for (var i = _listeners[event].length - 1; i >= 0; i--) {
               if (_listeners[event][i] == handler) {
                  _listeners[event].splice(i, 1);
               }
            }
            return _this;
         };

      init();

      _this = {
         id: id,
         getId: id,
         leg: id,
         getLeg: id,
         callId: callId,
         getUUID: uuid,
         getCallId: callId,
         active: active,
         isActive: active,
         setActive: setActive,
         state: state,
         getState: state,
         displayName: displayName,
         getDisplayName: displayName,
         getCallback: getCallback,
         number: number,
         getDiversion: diversion,
         getNumber: number,
         headers: headers,
         getHeaders: headers,
         cdr: cdr,
         getCdr: cdr,

         addEventListener: addEventListener,
         removeEventListener: removeEventListener,

         hangup: hangup,
         cancel: cancel,
         provision: provision,
         update: update,
         hold: update,
         transfer: transfer,
         sendTone: sendTone,
         sendDTMF: sendTone,

         muteMicrophone: muteMicrophone,
         mutePlayback: mutePlayback,
         unmuteMicrophone: unmuteMicrophone,
         unmutePlayback: unmutePlayback,

         isPlaybackMuted: isPlaybackMuted,
         isMicrophoneMuted: isMicrophoneMuted,
      };
      if (_cdr.direction == "in") {
         _this.answer = answer;
         _this.decline = decline;
         _this.reject = reject;
      } else {
         _this.dial = dial;
      }
      return _this;
   };

   itl.WebRTC.Client = function () {
      var Call = itl.WebRTC.Call,
         _this,
         _initialized = false,
         _RTCSupported = false,
         _config = null,
         _conn,
         _calls = {},
         _activeCall,
         _isConnected = false,
         _isLoggedIn = false,
         _loginInProgress = false,
         _listeners = {},
         _audioSourcesList = [],
         _deviceAPI =
            typeof MediaStreamTrack != "undefined" &&
            typeof MediaStreamTrack.getSources != "undefined",
         _audioCodecPriority,
         /** @ignore */
         dispatchEvent = function (e) {
            var event = e.name;
            if (_listeners[event]) {
               for (var i = 0; i < _listeners[event].length; i++) {
                  if (typeof _listeners[event][i] == "function") {
                     _listeners[event][i].call(null, e);
                  }
               }
            }
         },
         /** @ignore */
         gotSources = function (sourceInfos) {
            if (_audioSourcesList.length != 0) _audioSourcesList = [];
            var a = 0;
            for (var i = 0; i != sourceInfos.length; ++i) {
               var sourceInfo = sourceInfos[i];
               if (sourceInfo.kind === "audio") {
                  a++;
                  _audioSourcesList.push({
                     id: sourceInfo.id,
                     name: sourceInfo.label || "Audio recording device " + a,
                  });
               }
            }
            dispatchEvent({ name: ITooLabs.WebRTC.Events.SourcesInfoUpdated });
         },
         /**
          * Initialize SDK. SDKReady event will be dispatched after succesful SDK initialization. SDK can't be used until it's initialized
          * @param {ITooLabs.WebRTC.Config} [config] Client configuration options
          */
         init = function (config) {
            if (_initialized) throw new Error("ALREADY_INITIALIZED");

            _config = config || {};

            if (!_RTCSupported) throw new Error("NO_WEBRTC_SUPPORT");

            _conn = itl.WebRTC.APIConnection(
               "wss://" +
                  (_config.APIHostName || location.hostname) +
                  "/ws" +
                  (_config.domain ? "/?_domain=" + _config.domain : ""),
               null,
               _config.debug
            );
            _conn
               .addListener("onConnected", function () {
                  _isConnected = true;
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.ConnectionEstablished,
                  });
               })
               .addListener("onDisconnected", function () {
                  _isConnected = false;
                  _isLoggedIn = false;
                  _loginInProgress = false;
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.ConnectionClosed,
                     event: event,
                  });
               })
               .addListener("onConnectionFailed", function (event) {
                  _isConnected = false;
                  _isLoggedIn = false;
                  _loginInProgress = false;
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.ConnectionFailed,
                     event: event,
                  });
               });
            _conn.addListener("onMessage", function (msg) {
               if (msg) {
                  switch (msg.What) {
                     case "incomingCall":
                        var theCall = Call(msg, null, null, null, _conn);
                        _calls[theCall.id()] = theCall;

                        theCall
                           .addEventListener(
                              itl.WebRTC.CallEvents.Connected,
                              function (event) {
                                 if (event && event.call) {
                                    if (_activeCall) {
                                       _activeCall.setActive(false);
                                    }
                                    _activeCall = theCall;
                                 }
                              }
                           )
                           .addEventListener(
                              itl.WebRTC.CallEvents.Disconnected,
                              function (event) {
                                 if (event && event.call) {
                                    if (_activeCall == event.call) {
                                       _activeCall = null;
                                    }
                                    delete _calls[event.call.id()];
                                 }
                              }
                           )
                           .addEventListener(
                              itl.WebRTC.CallEvents.Failed,
                              function (event) {
                                 if (event && event.call) {
                                    if (_activeCall == event.call) {
                                       _activeCall = null;
                                    }
                                    delete _calls[event.call.id()];
                                 }
                              }
                           )
                           .provision();

                        dispatchEvent({
                           name: itl.WebRTC.Events.IncomingCall,
                           call: theCall,
                        });
                        break;
                     case "onMessage":
                        delete msg.What;
                        dispatchEvent({
                           name: itl.WebRTC.Events.OnMessage,
                           msg: msg,
                        });
                        break;
                  }
               }
            });

            function checkDOMReady() {
               if (typeof document != "undefined") {
                  clearInterval(ts);
                  ts = null;
                  var element = document.createElement("audio");
                  element.id = "itl_webrtc_container";
                  element.autoplay = true;
                  element.style.display = "none";
                  if (document.body.firstChild)
                     document.body.insertBefore(element, document.body.firstChild);
                  else document.body.appendChild(element);

                  dispatchEvent({ name: ITooLabs.WebRTC.Events.SDKReady });
                  if (_deviceAPI) MediaStreamTrack.getSources(gotSources);
               }
            }

            var ts = setInterval(checkDOMReady, 100);
            _initialized = true;
            return _this;
         },
         isRTCsupported = function () {
            return _RTCSupported;
         },
         config = function () {
            return _config;
         },
         addEventListener = function (event, handler) {
            if (!_listeners[event]) _listeners[event] = [];
            _listeners[event].push(handler);
            return _this;
         },
         removeEventListener = function (event, handler) {
            if (!_listeners || !_listeners[event] || !_listeners[event].length)
               return;

            for (var i = _listeners[event].length - 1; i >= 0; i--) {
               if (_listeners[event][i] == handler) {
                  _listeners[event].splice(i, 1);
               }
            }
            return _this;
         },
         connect = function () {
            if (!_initialized) throw new Error("NOT_INITIALIZED_YET");
            if (!_conn) throw new Error("NO_CONNECTION");

            _conn.connect();
            return _this;
         },
         disconnect = function (resetInitialized) {
            if (!_initialized) throw new Error("NOT_INITIALIZED_YET");
            if (!_conn) throw new Error("NO_CONNECTION");

            if (_calls) {
               for (var c in _calls) {
                  _calls[c].hangup();
               }
            }
            unbind();
            if (resetInitialized) {
               _initialized = false;
            }
            _conn.disconnect();
            return _this;
         },
         connected = function () {
            return _isConnected;
         },
         initialized = function () {
            return _initialized;
         },
         login = function (username, password, createAuthToken) {
            if (!_conn || !_isConnected) return;
            if (_isLoggedIn || _loginInProgress) return;

            _loginInProgress = true;
            const requestData = {
               "": "login",
               username: username,
               password: password,
            };
            if (createAuthToken) {
               requestData.createAuthToken = true;
            }
            _conn.sendRequest(requestData, function (msg) {
               if (msg && msg.error) {
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.AuthResult,
                     result: false,
                     code: 404,
                  });
               } else {
                  if (msg.webrtcAudioCodecPriority) {
                     _audioCodecPriority = msg.webrtcAudioCodecPriority;
                  }
                  const dispatchData = {
                     name: ITooLabs.WebRTC.Events.AuthResult,
                     result: true,
                  };
                  if (msg.token) {
                     dispatchData.token = msg.token;
                     dispatchData.user = username.split("@")[0];
                  }
                  dispatchEvent(dispatchData);
                  if (!_config || _config.bind !== false) {
                     bind();
                  }
                  _isLoggedIn = true;
               }
               _loginInProgress = false;
            });
            return _this;
         },
         loginByAuthToken = function (username, token) {
            if (!_conn || !_isConnected) return;
            if (_isLoggedIn || _loginInProgress) return;

            _loginInProgress = true;
            _conn.sendRequest(
               { "": "login", username: username, authtoken: token },
               function (msg) {
                  if (msg && msg.error) {
                     dispatchEvent({
                        name: ITooLabs.WebRTC.Events.AuthResult,
                        result: false,
                        code: 404,
                     });
                  } else {
                     if (msg.webrtcAudioCodecPriority) {
                        _audioCodecPriority = msg.webrtcAudioCodecPriority;
                     }
                     dispatchEvent({
                        name: ITooLabs.WebRTC.Events.AuthResult,
                        result: true,
                     });
                     if (!_config || _config.bind !== false) {
                        bind();
                     }
                     _isLoggedIn = true;
                  }
                  _loginInProgress = false;
               }
            );
            return _this;
         },
         loginByToken = function (id, token) {
            if (!_conn || !_isConnected) return;
            if (_isLoggedIn || _loginInProgress) return;

            _loginInProgress = true;
            _conn.sendRequest({ "": "login", id: id, token: token }, function (msg) {
               if (msg && msg.error) {
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.AuthResult,
                     result: false,
                     code: 404,
                  });
               } else {
                  if (msg.webrtcAudioCodecPriority) {
                     _audioCodecPriority = msg.webrtcAudioCodecPriority;
                  }
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.AuthResult,
                     result: true,
                     data: msg,
                  });
                  if (!_config || _config.bind !== false) {
                     bind();
                  }
                  _isLoggedIn = true;
               }
               _loginInProgress = false;
            });
            return _this;
         },
         loginBySession = function (s) {
            if (!_conn || !_isConnected) return;
            if (_isLoggedIn || _loginInProgress) return;

            _loginInProgress = true;
            _conn.sendRequest({ "": "login", s: s }, function (msg) {
               if (msg && msg.error) {
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.AuthResult,
                     result: false,
                     code: 404,
                  });
               } else {
                  if (msg.webrtcAudioCodecPriority) {
                     _audioCodecPriority = msg.webrtcAudioCodecPriority;
                  }
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.AuthResult,
                     result: true,
                  });
                  if (!_config || _config.bind !== false) {
                     bind();
                  }
                  _isLoggedIn = true;
               }
               _loginInProgress = false;
            });
            return _this;
         },
         bind = function () {
            _conn.sendRequest({ "": "Bind" }, function (rs) {
               if (rs) {
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.BindResult,
                     result: false,
                  });
               } else {
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.BindResult,
                     result: true,
                  });
               }
            });
            return _this;
         },
         unbind = function () {
            _conn.sendRequest({ "": "Bind", mode: "kill" }, function (rs) {
               if (rs) {
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.UnbindResult,
                     result: false,
                  });
               } else {
                  dispatchEvent({
                     name: ITooLabs.WebRTC.Events.UnbindResult,
                     result: true,
                  });
               }
            });
            return _this;
         },
         audioSources = function () {
            if (_RTCSupported) {
               if (!_deviceAPI)
                  throw new Error("NOT_SUPPORTED [MediaStreamTrack.getSources]");
            }
            return _audioSourcesList;
         },
         removeEventListeners = function () {
            _listeners = {};
         },
         call = function (num, customData, extraHeaders) {
            var theCall = Call(
               null,
               num,
               customData ? customData.dn : null,
               extraHeaders,
               _conn,
               null,
               _audioCodecPriority
            );
            _calls[theCall.id()] = theCall;

            if (_activeCall) {
               _activeCall.setActive(false);
            }
            _activeCall = theCall;

            theCall
               .addEventListener(
                  itl.WebRTC.CallEvents.Connected,
                  function (event) {}
               )
               .addEventListener(
                  itl.WebRTC.CallEvents.Disconnected,
                  function (event) {
                     if (event && event.call) {
                        if (_activeCall == event.call) {
                           _activeCall = null;
                        }
                        delete _calls[event.call.id()];
                     }
                  }
               )
               .addEventListener(itl.WebRTC.CallEvents.Failed, function (event) {
                  if (event && event.call) {
                     if (_activeCall == event.call) {
                        _activeCall = null;
                     }
                     delete _calls[event.call.id()];
                  }
               });
            return theCall;
         },
         sendMakeCall = function (phone) {
            if (!phone) return;
            _conn.sendRequest({ "": "makeCall", phone: phone });
            return _this;
         },
         callStarted = function () {
            _conn.sendRequest({ "": "callStarted" });
            return _this;
         },
         setCallActive = function (call, active) {
            return _this;
         },
         getActiveCall = function () {
            return _activeCall;
         },
         getCallById = function (id) {
            return _calls[id];
         },
         sendInfo = function (feature, event, data) {
            _conn.sendRequest({
               "": "feature_event",
               feature,
               event,
               data,
            });
         },
         sendLog = function (data, fn, cb) {
            _conn.sendRequest({ "": "logfile", fn: fn, data: data }, function (rs) {
               if (cb) cb(rs);
            });
         },
         setAudioCodecPriority = function (codecs) {
            if (codecs) _audioCodecPriority = codecs;
         },
         getUserMedia = function () {
            return new Promise((resolve, reject) => {
               _getUserMedia()
                  .then((stream) => {
                     resolve(stream);
                  })
                  .catch((e) => {
                     reject(e);
                  });
            });
         };

      /* Check if WebRTC is supported */
      if (RTCPeerConnection) {
         if (typeof RTCPeerConnection != "undefined") {
            try {
               new RTCPeerConnection({ iceServers: [] });
               _RTCSupported = true;
            } catch (e) {
               /* not enabled */
            }
         } else {
            _RTCSupported = true;
         }
      }

      _this = {
         init: init,
         initialized: initialized,
         isInitialized: initialized,
         isRTCsupported: isRTCsupported,

         config: config,
         getConfig: config,

         addEventListener: addEventListener,
         removeEventListener: removeEventListener,
         removeEventListeners: removeEventListeners,

         connect: connect,
         disconnect: disconnect,
         connected: connected,
         isConnected: connected,

         login: login,
         loginByToken: loginByToken,
         loginBySession: loginBySession,
         loginByAuthToken: loginByAuthToken,
         bind: bind,
         unbind: unbind,

         audioSources: audioSources,
         setAudioCodecPriority: setAudioCodecPriority,

         call: call,
         makeCall: call,
         callStarted: callStarted,
         setCallActive: setCallActive,
         getCallById: getCallById,
         getActiveCall: getActiveCall,

         sendInfo: sendInfo,
         sendLog: sendLog,
         sendMakeCall: sendMakeCall,

         getUserMedia: getUserMedia,
      };

      return _this;
   };

   itl.WebRTC.Factory = (function () {
      var client = itl.WebRTC.Client(),
         getInstance = function () {
            return ud;
         };

      __attach(window, "beforeunload", function (e) {
         if (client.isConnected()) client.disconnect();
      });

      return {
         getInstance: getInstance,
      };
   })();

   /**
    * Events dispatched by {@link ITooLabs.WebRTC.Client} instance. See {@link ITooLabs.WebRTC.getInstance}.
    * @namespace
    * @name ITooLabs.WebRTC.Events
    */
   itl.WebRTC.Events = {
      /**
       * @class
       * Event dispatched after SDK was successfully initialized after {@link ITooLabs.WebRTC.Client#init|init} function call
       */
      SDKReady: "SDKReady",
      /**
       * @class
       * Event dispatched after connection to ITooLabs Centrex was established successfully. See {@link ITooLabs.WebRTC.Client#connect|connect} function.
       */
      ConnectionEstablished: "ConnectionEstablished",
      /**
       * @class
       * Event dispatched if connection to ITooLabs Centrex couldn't be established. See {@link ITooLabs.WebRTC.Client#connect|connect} function.
       * @param {String} message Failure reason description
       */
      ConnectionFailed: "ConnectionFailed",
      /**
       * @class
       * Event dispatched if connection to ITooLabs Centrex was closed because of network problems. See {@link ITooLabs.WebRTC.Client#connect|connect} function.
       */
      ConnectionClosed: "ConnectionClosed",
      /**
       * @class
       * Event dispatched after {@link ITooLabs.WebRTC.Client.login} function call.
       * @param {Boolean} result true in case of successful authorization, false - otherwise.
       * @param {Number} [code] Auth error code, possible values are: 404 - invalid username or password, 500 - internal error.
       * @param {String} [token] for authorization.
       * @param {String} [user] user login for authorization.
       */
      AuthResult: "AuthResult",
      /**
       * @class
       * Event dispatched after {@link ITooLabs.WebRTC.Client.bind} function call.
       * @param {Boolean} result true in case of successful bind, false - otherwise.
       */
      BindResult: "BindResult",
      /**
       * @class
       * Event dispatched when there is a new incoming call to current user.
       * @param {ITooLabs.WebRTC.Call} call Incoming call instance. See {@link ITooLabs.WebRTC.Call} for details.
       */
      UnbindResult: "UnbindResult",
      /**
       * @class
       * Event dispatched after {@link ITooLabs.WebRTC.Client.unbind} function call.
       * @param {Boolean} result true in case of successful bind, false - otherwise.
       */
      IncomingCall: "IncomingCall",
      /**
       * @class
       * Event dispatched when audio sources information was updated. See {@link ITooLabs.WebRTC.Client#audioSources} for details.
       */
      SourcesInfoUpdated: "SourcesInfoUpdated",
      /**
       * @class
       * Event dispatched when ws message is received.
       */
      OnMessage: "OnMessage",
   };

   /**
    * Events dispatched by {@link ITooLabs.WebRTC.Call} instance
    * @namespace
    * @name ITooLabs.WebRTC.CallEvents
    */
   itl.WebRTC.CallEvents = {
      /**
       * @class
       * Event dispatched after call was connected.
       * @param {ITooLabs.WebRTC.Call} call Call that dispatched the event.
       */
      Connected: "Connected",
      /**
       * @class
       * Event dispatched after call was disconnected.
       * @param {ITooLabs.WebRTC.Call} call Call that dispatched the event.
       */
      Disconnected: "Disconnected",
      /**
       * @class
       * Event dispatched after if call failed.
       * @param {Number} code Status code of the call (i.e. 486)
       * @param {String} reason Status message of call failure (i.e. Busy Here)
       * @param {ITooLabs.WebRTC.Call} call Call that dispatched the event.
       */
      Failed: "Failed",
      /**
       * @class
       * Event dispatched when INFO message is received.
       * @param {String} mimeType MIME type of INFO message.
       * @param {String} body Content of the message.
       * @param {Object} [headers] Optional SIP headers received with the message.
       * @param {ITooLabs.WebRTC.Call} call Call that dispatched the event.
       */
      InfoReceived: "InfoReceived",
   };

   itl.WebRTC.CallState = {
      Initialized: "Initialized",
      Dial: "Dial",
      Provisioned: "Provisioned",
      Hold: "Hold",
      Connected: "Connected",
      Disconnected: "Disconnected",
   };
})((window.ITooLabs = window.ITooLabs || {}));
