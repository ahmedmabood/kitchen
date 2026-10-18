import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

let registered = false

/** Registers GSAP plugins on first app mount so scroll sections can animate. */
export const LazyGsap = {
  init() {
    if (registered) return
    gsap.registerPlugin(ScrollTrigger)
    registered = true
  },
  get gsap() {
    return gsap
  },
  get ScrollTrigger() {
    return ScrollTrigger
  },
}
