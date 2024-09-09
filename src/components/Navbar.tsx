import { FaBars, FaTimes } from "react-icons/fa";
import { FaGear } from "react-icons/fa6";

const Navbar = () => {
    return (
        <div className="navbar backdrop-blur-3xl opacity-90 bg-neutral sticky top-0 z-50">
            <div className="flex-none">
                <label className="btn btn-circle btn-ghost swap swap-rotate">
                    <input type="checkbox" />
                    <FaBars className="text-2xl swap-on" />
                    <FaTimes className="text-2xl swap-off" />
                </label>
            </div>
            <div className="flex-1 text-3xl font-bold">
                Melomaniac
            </div>
            <div className="flex-none">
                <button className="btn btn-circle btn-ghost">
                    <FaGear className="text-2xl" />
                </button>
            </div>
        </div>
    );
}

export default Navbar;
