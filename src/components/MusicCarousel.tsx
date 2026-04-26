import { Swiper, SwiperSlide } from "swiper/react"
import { EffectCoverflow } from 'swiper/modules';
import MusicCard from "./MusicCard"

import 'swiper/css';
import 'swiper/css/effect-coverflow';


const MusicCarousel = () => {
    return (
        <div className="container relative overflow-hidden">
            <Swiper
                effect={"coverflow"}
                centeredSlides={true}
                slidesPerView="auto"
                coverflowEffect={{
                    rotate: 15,
                    stretch: 0,
                    scale: 0.90,
                    depth: 100,
                    slideShadows: true,
                    modifier: 1
                }}
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
        </div>
    );
}

export default MusicCarousel;
