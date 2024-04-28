import React from "react";
import "../../scss/Home.scss";
import { useNavigate } from "react-router-dom";

function HomePage() {
   const [value, setValue] = React.useState("");

   const navigate = useNavigate();

   const onClick = () => {
      {
         value !== "" && navigate(`/room/${value}`);
      }
   };
   return (
      <div className="home">
         <h1>Home</h1>
         <input
            className="home__input"
            placeholder="enter conference id"
            value={value}
            onChange={(e) => setValue(e.target.value)}
         />
         {value === "" ? <span className="error">Please, enter valid id</span> : null}
         <button className="home__button" onClick={onClick}>
            Join conference
         </button>
      </div>
   );
}

export default HomePage;
