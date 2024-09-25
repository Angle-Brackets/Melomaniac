import { FaPlayCircle, FaPauseCircle, FaFastForward, FaFastBackward, FaRegHeart, FaHeart, FaPlus} from "react-icons/fa";
import { FaShuffle } from "react-icons/fa6";

const MusicControls = () => {
    return (
        <div className="flex flex-col items-center">
            <progress className="progress w-80" value="23" max="100"/>
            <div className="flex flex-row text-3xl text-center">
                <button className="btn btn-circle btn-ghost text-3xl">
                    <FaFastBackward/>
                </button>

                <div className="tooltip" data-tip="Toggle Shuffle">
                    <button className="btn btn-circle btn-ghost text-3xl">
                        <label className="swap">
                            <input type="checkbox"/>
                            <FaShuffle className="swap-on fill-cyan-200"/>
                            <FaShuffle className="swap-off fill-current"/>
                        </label>
                    </button>
                </div>

                <button className="btn btn-circle btn-ghost text-3xl">
                    <label className="swap swap-rotate">
                        <input type="checkbox"/>
                        <FaPlayCircle className="swap-on fill-current"/>
                        <FaPauseCircle className="swap-off fill-current"/>
                    </label>
                </button>

                <button className="btn btn-circle btn-ghost text-3xl">
                    <FaPlus/>
                </button>
                <button className="btn btn-circle btn-ghost text-3xl">
                    <FaFastForward/>
                </button>
            </div>
        </div>
    );
}

export default MusicControls;