import React from "react";
import "./App.css";
import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import RoomPage from "./pages/RootPage";

function App() {
   return (
      <Routes>
         <Route path="/" element={<HomePage />} />
         <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
   );
}

export default App;
