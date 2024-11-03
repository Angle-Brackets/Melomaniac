import { IoMusicalNote } from "react-icons/io5";
const MusicCard = () => {
    return (
        <div className="relative card flex clip items-center justify-center shadow-none bg-white w-full aspect-square rounded-xl overflow-hidden">
            <IoMusicalNote className="text-8xl text-gray-500" />
        </div>
    );
}

export default MusicCard;
