import { IoMusicalNote } from "react-icons/io5";

const MusicCard = () => {
    return (
        <div className="card flex items-center justify-center bg-white w-full aspect-square">
            <IoMusicalNote className="text-8xl text-gray-500" />
        </div>
    );
}

export default MusicCard;