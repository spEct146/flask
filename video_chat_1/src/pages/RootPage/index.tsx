import "../../scss/Root.scss";
import { ZegoUIKitPrebuilt } from "@zegocloud/zego-uikit-prebuilt";
import React from "react";
import { useParams } from "react-router-dom";

function RoomPage() {
   const { roomId } = useParams();

   const myMeeting = async (element: HTMLDivElement) => {
      const appId = 1942250738;
      const secretKey = "bbc98017b23d4f9837a725e9949fa4d3";

      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
         appId,
         secretKey,
         roomId as string,
         Date.now().toString(), //унакильный id
         "Name"
      );

      const zp = ZegoUIKitPrebuilt.create(kitToken);

      zp.joinRoom({
         container: element,
         sharedLinks: [
            {
               name: "Personal link",
               url: `http://localhost:5173/room/${roomId}`,
            },
         ],
         scenario: {
            mode: ZegoUIKitPrebuilt.GroupCall,
         },
         showTurnOffRemoteCameraButton: true,
         showTurnOffRemoteMicrophoneButton: true,
         showRemoveUserButton: true,
      });
   };
   return <div ref={myMeeting} />;
}

export default RoomPage;
