import Navbar from "./components/Navbar";
import MusicCarousel  from "./components/MusicCarousel"
import MusicInfo from "./components/MusicInfo"
import MusicControls from "./components/MusicControls"

function App() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar/>
      <div className="flex justify-center items-center pb-6 pt-6">
        <MusicCarousel />
      </div>

      <div className="flex justify-center items-center">
        <MusicInfo/>
      </div>

      <div className="flex justify-center items-center">
        <MusicControls/>
      </div>
    </div>
  );
}

export default App;
