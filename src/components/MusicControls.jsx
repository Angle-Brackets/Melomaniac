import { FaPlayCircle, FaPauseCircle, FaFastForward, FaFastBackward, FaRegHeart, FaHeart, FaPlus} from "react-icons/fa";
import { FaShuffle, FaRepeat } from "react-icons/fa6";

const MusicControls = () => {
    return (
        <div className="flex flex-col items-center">
            <progress className="progress w-[36rem]"/>

            <div className="flex flex-row text-3xl text-center">
                <button className="btn btn-lg btn-circle btn-ghost text-5xl">
                    <FaFastBackward/>
                </button>

                <div className="tooltip" data-tip="Toggle Shuffle">
                    <button className="btn btn-lg btn-circle btn-ghost text-5xl">
                        <label className="swap">
                            <input type="checkbox"/>
                            <FaShuffle className="swap-on fill-cyan-200"/>
                            <FaShuffle className="swap-off fill-current"/>
                        </label>
                    </button>
                </div>

                <button className="btn btn-lg btn-circle btn-ghost text-5xl">
                    <label className="swap">
                        <input type="checkbox"/>
                        <FaRegHeart className="swap-off fill-current"/>
                        <FaHeart className="swap-on fill-current"/>
                    </label>
                </button>

                <button className="btn btn-lg btn-circle btn-ghost text-5xl">
                    <label className="swap swap-rotate">
                        <input type="checkbox"/>
                        <FaPlayCircle className="swap-on fill-current"/>
                        <FaPauseCircle className="swap-off fill-current"/>
                    </label>
                </button>

                <button className="btn btn-lg btn-circle btn-ghost text-5xl">
                    <label className="swap">
                        <input type="checkbox"/>
                        <FaRepeat className="swap-on fill-current fill-cyan-200"/>
                        <FaRepeat className="swap-off fill-current"/>
                    </label>
                </button>

                <button className="btn btn-lg btn-circle btn-ghost text-5xl">
                    <FaPlus/>
                </button>
                <button className="btn btn-lg btn-circle btn-ghost text-5xl">
                    <FaFastForward/>
                </button>
            </div>
        </div>
    );
}

export default MusicControls;