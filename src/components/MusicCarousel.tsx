import { useState } from "react"
import { Swiper, SwiperSlide } from "swiper/react"
import { EffectCoverflow } from 'swiper/modules';
import MusicCard from "./MusicCard"

import 'swiper/css';
import 'swiper/css/effect-coverflow';


const MusicCarousel = () => {
    const [selectedItem, setSelectedItem] = useState(0);

    return (
        <div className="container">
            <Swiper
                effect={"coverflow"}
                centeredSlides={true}
                slidesPerView="auto"  // Automatically adjust based on slide width
                coverflowEffect={{
                    rotate: 0,
                    stretch: 0,
                    depth: 100,
                    modifier: 2.5
                }}
                onSlideChange={(swiper) => setSelectedItem(swiper.activeIndex)}
                modules={[EffectCoverflow]}
            >
                <SwiperSlide className="!w-80"> 
                    <MusicCard />
                </SwiperSlide>

                <SwiperSlide className="!w-80">  
                    <MusicCard />
                </SwiperSlide>

                <SwiperSlide className="!w-80">
                    <MusicCard />
                </SwiperSlide>

                <SwiperSlide className="!w-80">
                    <MusicCard />
                </SwiperSlide>

                <SwiperSlide className="!w-80">
                    <MusicCard />
                </SwiperSlide>

                <SwiperSlide className="!w-80">
                    <MusicCard />
                </SwiperSlide>
            </Swiper>
            <p>Selected Slide: {selectedItem}</p>
        </div>
    );
}

export default MusicCarousel;
