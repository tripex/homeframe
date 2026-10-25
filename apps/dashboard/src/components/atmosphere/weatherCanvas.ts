import type { Atmosphere } from "@homeframe/core";

/**
 * A small particle renderer for the ambient layer: stars, rain, snow, sleet,
 * hail, drifting fog bands and the rare soft storm glow.
 *
 * It is deliberately framework-free and cheap. Particle counts are capped,
 * the canvas renders at no more than 1.5× device pixels, and drawing stops
 * while the page is hidden. Screens like a Nest Hub run this all day.
 */

type Drop = { x: number; y: number; length: number; speed: number; drift: number; size: number; alpha: number };
type Star = { x: number; y: number; size: number; phase: number; speed: number };
type FogBand = { y: number; height: number; speed: number; offset: number; alpha: number };

export type WeatherScene = Pick<
  Atmosphere,
  "weather" | "precipitation" | "cloudCover" | "daylight" | "phase"
>;

const MAX_DROPS = 170;
const STAR_COUNT = 90;

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class WeatherCanvas {
  private context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private drops: Drop[] = [];
  private stars: Star[] = [];
  private fog: FogBand[] = [];
  private frame?: number;
  private lastTime = 0;
  private flash = 0;
  private nextFlashAt = 0;
  private scene: WeatherScene;
  private animate: boolean;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    scene: WeatherScene,
    options: { animate: boolean },
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
    this.scene = scene;
    this.animate = options.animate;
    this.resize();
    this.populate();
  }

  update(scene: WeatherScene, options: { animate: boolean }): void {
    const kindChanged = scene.weather !== this.scene.weather;
    this.scene = scene;
    this.animate = options.animate;
    if (kindChanged) this.populate();
    if (!this.animate) this.drawFrame(0);
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.populate();
  }

  start(): void {
    this.stop();
    const loop = (time: number) => {
      const delta = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.05) : 0;
      this.lastTime = time;
      if (!document.hidden) this.drawFrame(delta);
      if (this.animate) this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.lastTime = 0;
  }

  private populate(): void {
    const { weather, precipitation } = this.scene;
    const area = (this.width * this.height) / (1280 * 800);

    this.stars = Array.from({ length: Math.round(STAR_COUNT * Math.min(area, 1.4)) }, () => ({
      // Stars stay in the upper sky where a real horizon would not hide them.
      x: Math.random() * this.width,
      y: Math.pow(Math.random(), 1.6) * this.height * 0.7,
      size: random(0.4, 1.3),
      phase: Math.random() * Math.PI * 2,
      speed: random(0.3, 1.1),
    }));

    const precipitating = ["rain", "heavy-rain", "storm", "snow", "sleet", "hail"].includes(weather);
    const count = precipitating
      ? Math.round(Math.min(MAX_DROPS, 40 + precipitation * 130) * Math.min(area, 1.2))
      : 0;
    this.drops = Array.from({ length: count }, () => this.newDrop(true));

    this.fog =
      weather === "fog" || (weather === "cloudy" && this.scene.cloudCover > 0.8)
        ? Array.from({ length: weather === "fog" ? 5 : 2 }, (_, index) => ({
            y: this.height * (0.35 + index * 0.13),
            height: this.height * random(0.18, 0.3),
            speed: random(4, 10) * (index % 2 ? -1 : 1),
            offset: Math.random() * this.width,
            alpha: weather === "fog" ? random(0.05, 0.09) : 0.035,
          }))
        : [];
  }

  /** What one falling particle looks like depends on what is falling. */
  private newDrop(anywhere: boolean): Drop {
    const { weather } = this.scene;
    const snowy = weather === "snow" || (weather === "sleet" && Math.random() < 0.5);
    const hail = weather === "hail";
    const heavy = weather === "heavy-rain" || weather === "storm";

    return {
      x: Math.random() * (this.width + 200) - 100,
      y: anywhere ? Math.random() * this.height : random(-60, -10),
      length: snowy || hail ? 0 : heavy ? random(18, 30) : random(11, 20),
      speed: snowy ? random(18, 42) : hail ? random(420, 560) : heavy ? random(620, 820) : random(430, 600),
      drift: snowy ? random(-12, 12) : heavy ? 70 : 38,
      size: snowy ? random(1.2, 2.8) : hail ? random(1.4, 2.2) : random(0.6, 1.1),
      alpha: snowy ? random(0.35, 0.75) : random(0.12, 0.32),
    };
  }

  private drawFrame(delta: number): void {
    const { context: ctx, width, height, scene } = this;
    ctx.clearRect(0, 0, width, height);
    const time = performance.now() / 1000;

    // Stars: only in a dark, mostly clear sky.
    const starAlpha = (1 - scene.daylight) * (1 - scene.cloudCover * 0.9);
    if (starAlpha > 0.02) {
      ctx.fillStyle = "#e8eeff";
      for (const star of this.stars) {
        const twinkle = this.animate ? 0.65 + Math.sin(time * star.speed + star.phase) * 0.35 : 0.8;
        ctx.globalAlpha = starAlpha * twinkle * 0.8;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Fog: wide, soft horizontal bands sliding past each other.
    for (const band of this.fog) {
      band.offset = (band.offset + band.speed * delta + width) % width;
      const gradient = ctx.createLinearGradient(0, band.y - band.height / 2, 0, band.y + band.height / 2);
      gradient.addColorStop(0, "rgba(200,210,225,0)");
      gradient.addColorStop(0.5, `rgba(200,210,225,${band.alpha})`);
      gradient.addColorStop(1, "rgba(200,210,225,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
      for (const shift of [-width, 0]) {
        ctx.fillRect(band.offset + shift, band.y - band.height / 2, width, band.height);
      }
    }

    // Precipitation.
    ctx.lineCap = "round";
    for (let index = 0; index < this.drops.length; index += 1) {
      const drop = this.drops[index];
      drop.y += drop.speed * delta;
      drop.x += drop.drift * delta + (drop.length === 0 ? Math.sin(time + index) * 6 * delta : 0);
      if (drop.y > height + 40) this.drops[index] = this.newDrop(false);

      ctx.globalAlpha = drop.alpha;
      if (drop.length === 0) {
        ctx.fillStyle = "#eef3fb";
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const slant = (drop.drift / drop.speed) * drop.length;
        ctx.strokeStyle = "#b9cbe2";
        ctx.lineWidth = drop.size;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - slant, drop.y - drop.length);
        ctx.stroke();
      }
    }

    // Storm: a distant, slow brightening behind the clouds every so often.
    // Never a hard flash — wall displays are watched from across a room,
    // sometimes by people sensitive to flicker.
    if (scene.weather === "storm" && this.animate) {
      if (time > this.nextFlashAt) {
        this.flash = 1;
        this.nextFlashAt = time + random(14, 32);
      }
      if (this.flash > 0) {
        this.flash = Math.max(0, this.flash - delta * 0.6);
        const glow = ctx.createRadialGradient(width * 0.7, height * 0.1, 0, width * 0.7, height * 0.1, width * 0.7);
        glow.addColorStop(0, `rgba(190,205,255,${0.1 * Math.sin(this.flash * Math.PI)})`);
        glow.addColorStop(1, "rgba(190,205,255,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
      }
    }

    ctx.globalAlpha = 1;
  }
}
