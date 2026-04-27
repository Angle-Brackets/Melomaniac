import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Navbar from "./components/Navbar";
import MusicCarousel from "./components/MusicCarousel"
import MusicInfo from "./components/MusicInfo"
import MusicControls from "./components/MusicControls"

function App() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const timer = setTimeout(async () => {
      try {
        await invoke("debug_play_test_track");
      } catch (e) {
        console.error("[audio] debug autoplay failed:", e);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <div className="flex justify-center items-center pb-6 pt-6">
        <MusicCarousel />
      </div>

      <div className="flex justify-center items-center">
        <MusicInfo />
      </div>

      <div className="flex justify-center items-center">
        <MusicControls />
      </div>
    </div>
  );
}

export default App;
