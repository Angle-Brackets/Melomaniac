import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import MusicCarousel  from "./components/MusicCarousel" 

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <div className="flex justify-center items-center">
      <MusicCarousel/>
    </div>
  );
}

export default App;
