import { IoMusicalNote } from "react-icons/io5";
import { FaRegHeart, FaHeart } from "react-icons/fa";

const MusicCard = () => {
    return (
        <div className="relative card flex clip items-center justify-center shadow-none bg-white w-full aspect-square rounded-xl overflow-hidden">
            <FaHeart className="absolute top-2 right-2 text-xl text-gray-500 cursor-pointer" />
            <IoMusicalNote className="text-8xl text-gray-500" />
        </div>
    );
}

export default MusicCard;
