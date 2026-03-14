'use client'

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// ── Shaders ──────────────────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAG_SRC = `
precision mediump float;

uniform sampler2D u_image;
uniform vec2      u_mouse;
uniform float     u_time;
uniform float     u_intensity;
uniform float     u_imageAspect;
uniform float     u_canvasAspect;

varying vec2 v_uv;

vec2 coverUV(vec2 uv) {
  vec2 s = u_canvasAspect > u_imageAspect
    ? vec2(1.0, u_imageAspect / u_canvasAspect)
    : vec2(u_canvasAspect / u_imageAspect, 1.0);
  return (uv - 0.5) * s + 0.5;
}

void main() {
  vec2 uv = v_uv;

  vec2 aspect  = vec2(u_canvasAspect, 1.0);
  vec2 toMouse = (uv - u_mouse) * aspect;
  float dist   = length(toMouse);

  // ── Glass disc with hard-ish edge ──────────────────────────────────────────
  float radius = 0.26;
  float inside = smoothstep(radius, radius - 0.012, dist);
  float strength = inside * u_intensity;

  float t = clamp(dist / radius, 0.0, 1.0);

  vec2 dirScreen = normalize(toMouse + vec2(0.00001));
  vec2 dirUV     = dirScreen / aspect;

  // ── Convex lens magnification ──────────────────────────────────────────────
  float lensMag = 0.13 * strength * (1.0 - t * t);
  vec2  lensOff = -dirUV * lensMag;

  // ── Chromatic aberration: tight at centre, explodes at rim ────────────────
  float aber = 0.018 * (t * t) * inside * u_intensity;

  vec2 uvR = coverUV(uv + lensOff + dirUV * aber);
  vec2 uvG = coverUV(uv + lensOff);
  vec2 uvB = coverUV(uv + lensOff - dirUV * aber);

  float r = texture2D(u_image, uvR).r;
  float g = texture2D(u_image, uvG).g;
  float b = texture2D(u_image, uvB).b;

  // ── Specular highlight — drifting light source ────────────────────────────
  float la = u_time * 0.28;
  vec2  lightDir = normalize(vec2(cos(la) * 0.35 - 0.15, sin(la) * 0.28 + 0.8));
  float nDotL = dot(normalize(-toMouse + vec2(0.00001)), lightDir);
  float spec  = pow(max(0.0, nDotL), 16.0) * inside * u_intensity * 0.28;

  // ── Bright rim ─────────────────────────────────────────────────────────────
  float rim = smoothstep(radius - 0.02, radius - 0.005, dist) * inside * u_intensity * 0.20;

  float glow = strength * 0.02;

  gl_FragColor = vec4(
    clamp(r + spec + rim + glow, 0.0, 1.0),
    clamp(g + spec + rim + glow, 0.0, 1.0),
    clamp(b + spec + rim + glow, 0.0, 1.0),
    1.0
  );
}
`

// ── WebGL helpers ────────────────────────────────────────────────────────────────

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader))
    return null
  }
  return shader
}

function buildProgram(gl: WebGLRenderingContext, vert: string, frag: string) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag)
  if (!vs || !fs) return null
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog))
    return null
  }
  return prog
}

// ── Data ─────────────────────────────────────────────────────────────────────────

interface GalleryItem {
  id: number
  number: string
  title: string
  hashtag: string
  quote: string
  location: string
  image: string
  imageLarge: string
  bgColor: string
}

const ITEMS: GalleryItem[] = [
  { id: 1,  number: '01', title: 'Silence',  hashtag: 'Hastag 001', quote: 'Silence speaks in ways words cannot reach.', location: 'Paris, FR.',        image: '/images/img1.webp',  imageLarge: '/images/img1.webp',  bgColor: '#1C1C1C' },
  { id: 2,  number: '02', title: 'Reverie',  hashtag: 'Hastag 002', quote: 'A reverie that lingers beyond morning light.',  location: 'Milan, IT.',         image: '/images/img2.webp',  imageLarge: '/images/img2.webp',  bgColor: '#A89880' },
  { id: 3,  number: '03', title: 'Absence',  hashtag: 'Hastag 003', quote: 'Beauty found only in the space left behind.',  location: 'London, UK.',        image: '/images/img3.webp',  imageLarge: '/images/img3.webp',  bgColor: '#BFB09E' },
  { id: 4,  number: '04', title: 'Longing',  hashtag: 'Hastag 004', quote: 'Distance measured not in miles but longing.',  location: 'Tokyo, JP.',         image: '/images/img4.webp',  imageLarge: '/images/img4.webp',  bgColor: '#6B5A45' },
  { id: 5,  number: '05', title: 'Lament',   hashtag: 'Hastag 005', quote: 'A lament whispered softly to the dark room.',  location: 'New York, NY.',      image: '/images/img5.webp',  imageLarge: '/images/img5.webp',  bgColor: '#2E2924' },
  { id: 6,  number: '06', title: 'Grace',    hashtag: 'Hastag 006', quote: 'Grace discovered in the unguarded still moment.', location: 'Los Angeles, CA.', image: '/images/img6.webp',  imageLarge: '/images/img6.webp',  bgColor: '#C8B89A' },
  { id: 7,  number: '07', title: 'Drift',    hashtag: 'Hastag 007', quote: 'To drift between worlds unseen and known.',   location: 'Seoul, KR.',         image: '/images/img7.webp',  imageLarge: '/images/img7.webp',  bgColor: '#3A3530' },
  { id: 8,  number: '08', title: 'Tender',   hashtag: 'Hastag 008', quote: 'Tenderness as armour, softness as strength.',  location: 'Copenhagen, DK.',    image: '/images/img8.webp',  imageLarge: '/images/img8.webp',  bgColor: '#D4C5B2' },
  { id: 9,  number: '09', title: 'Hollow',   hashtag: 'Hastag 009', quote: 'What remains within the hollow resonates.',   location: 'Vienna, AT.',        image: '/images/img9.webp',  imageLarge: '/images/img9.webp',  bgColor: '#1A1814' },
  { id: 10, number: '10', title: 'Vestige',  hashtag: 'Hastag 010', quote: 'Vestige of all the light once held here.',    location: 'Berlin, DE.',        image: '/images/img10.webp', imageLarge: '/images/img10.webp', bgColor: '#8C7B6A' },
]

// ── Per-item layout (staggered positions à la cathydolle.com) ─────────────────────

// ml in vw (relative to the 50vw column) — left ~3vw, right ~13vw
const LAYOUT = [
  { ml: '3vw',  w: 310, h: 400 },
  { ml: '13vw', w: 272, h: 352 },
  { ml: '4vw',  w: 302, h: 390 },
  { ml: '14vw', w: 258, h: 334 },
  { ml: '2vw',  w: 318, h: 412 },
  { ml: '12vw', w: 280, h: 362 },
  { ml: '5vw',  w: 306, h: 396 },
  { ml: '13vw', w: 264, h: 342 },
  { ml: '3vw',  w: 312, h: 404 },
  { ml: '12vw', w: 268, h: 346 },
]

// ── Component ─────────────────────────────────────────────────────────────────────

export default function Intro() {
  const [activeIndex, setActiveIndex] = useState(0)

  // ── Existing layout refs ────────────────────────────────────────────────────
  const leftRef   = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([])
  const imgRefs   = useRef<(HTMLImageElement | null)[]>([])  // for parallax
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ── WebGL refs ──────────────────────────────────────────────────────────────
  const glRef          = useRef<WebGLRenderingContext | null>(null)
  const textureRef     = useRef<WebGLTexture | null>(null)
  const uniformsRef    = useRef<Record<string, WebGLUniformLocation | null>>({})
  const mouseRef       = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 })
  const intensityRef   = useRef({ current: 0, target: 0 })
  const imageAspectRef = useRef(1)
  const rafRef         = useRef<number>(0)

  // ── Intro animation refs ────────────────────────────────────────────────────
  const introRef       = useRef<HTMLDivElement>(null)
  const line1Ref       = useRef<HTMLDivElement>(null)
  const line2Ref       = useRef<HTMLDivElement>(null)
  const barRef         = useRef<HTMLDivElement>(null)
  const leftCurtainRef = useRef<HTMLDivElement>(null)
  const rightCurtainRef = useRef<HTMLDivElement>(null)

  // ── Scroll: thumbnail closest to viewport mid ───────────────────────────────
  useEffect(() => {
    const col = leftRef.current
    if (!col) return
    const onScroll = () => {
      const mid = col.scrollTop + col.clientHeight / 2
      let best = 0, bestDist = Infinity
      thumbRefs.current.forEach((el, i) => {
        if (!el) return
        const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid)
        if (d < bestDist) { bestDist = d; best = i }
      })
      setActiveIndex(best)
    }
    col.addEventListener('scroll', onScroll, { passive: true })
    return () => col.removeEventListener('scroll', onScroll)
  }, [])

  // ── WebGL init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return
    glRef.current = gl
    const prog = buildProgram(gl, VERT_SRC, FRAG_SRC)
    if (!prog) return
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(prog, 'a_position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
    uniformsRef.current = {
      u_image: gl.getUniformLocation(prog, 'u_image'),
      u_mouse: gl.getUniformLocation(prog, 'u_mouse'),
      u_time: gl.getUniformLocation(prog, 'u_time'),
      u_intensity: gl.getUniformLocation(prog, 'u_intensity'),
      u_imageAspect: gl.getUniformLocation(prog, 'u_imageAspect'),
      u_canvasAspect: gl.getUniformLocation(prog, 'u_canvasAspect'),
    }
    gl.useProgram(prog)
    gl.uniform1i(uniformsRef.current.u_image, 0)
    const tex = gl.createTexture()!
    textureRef.current = tex
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width  = canvas.clientWidth  * dpr
      canvas.height = canvas.clientHeight * dpr
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)
    let lastTs = 0, elapsed = 0
    const frame = (ts: number) => {
      const dt = Math.min((ts - lastTs) / 1000, 0.05)
      lastTs = ts
      elapsed += dt
      const m = mouseRef.current
      m.x += (m.tx - m.x) * 0.07
      m.y += (m.ty - m.y) * 0.07
      const inten = intensityRef.current
      inten.current += (inten.target - inten.current) * 0.05
      gl.useProgram(prog)
      const u = uniformsRef.current
      gl.uniform2f(u.u_mouse, m.x, m.y)
      gl.uniform1f(u.u_time, elapsed)
      gl.uniform1f(u.u_intensity, inten.current)
      gl.uniform1f(u.u_imageAspect, imageAspectRef.current)
      gl.uniform1f(u.u_canvasAspect, canvas.width / canvas.height)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize) }
  }, [])

  // ── Load texture on active item change ──────────────────────────────────────
  useEffect(() => {
    const gl  = glRef.current
    const tex = textureRef.current
    if (!gl || !tex) return
    const img = new window.Image()
    img.onload = () => {
      imageAspectRef.current = img.naturalWidth / img.naturalHeight
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    }
    img.src = ITEMS[activeIndex].imageLarge
  }, [activeIndex])

  // ── Intro + scroll animations ────────────────────────────────────────────────
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const col = leftRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── Set initial states for thumbnails ──────────────────────────────────
    thumbRefs.current.forEach(el => {
      if (el) gsap.set(el, { clipPath: 'inset(100% 0 0 0)', opacity: 0, scale: 0.92 })
    })

    // ── Parallax on thumbnail images ───────────────────────────────────────
    if (col) {
      imgRefs.current.forEach(img => {
        if (!img) return
        gsap.fromTo(img,
          { y: -20 },
          {
            y: 20,
            ease: 'none',
            scrollTrigger: {
              trigger: img.closest('.thumb-wrap'),
              scroller: col,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
            },
          }
        )
      })
    }

    // ── Reduced motion: skip intro, reveal everything immediately ──────────
    if (reduced) {
      gsap.set([introRef.current, leftCurtainRef.current, rightCurtainRef.current], { autoAlpha: 0 })
      thumbRefs.current.forEach(el => {
        if (el) gsap.set(el, { clipPath: 'inset(0% 0 0 0)', opacity: 1, scale: 1 })
      })
      return
    }

    // ── Intro GSAP timeline ────────────────────────────────────────────────
    // Bar starts centred (GSAP manages all transforms; no CSS transform on barRef)
    gsap.set(barRef.current, { xPercent: -50, yPercent: -50, opacity: 0 })
    gsap.set([line1Ref.current, line2Ref.current], { opacity: 0, y: 22 })

    const tl = gsap.timeline()

    tl
      // Phase 1 — Text reveal
      .to(line1Ref.current, { opacity: 1, y: 0, duration: 0.65, ease: 'power2.out' })
      .to(line2Ref.current, { opacity: 1, y: 0, duration: 0.65, ease: 'power2.out' }, '-=0.35')
      .to({}, { duration: 1.0 }) // hold

      // Phase 2 — Text drifts up (parallax-like exit), bar fades in
      .to(line1Ref.current, {
        y: -38, opacity: 0, duration: 0.9, ease: 'sine.inOut',
      })
      .to(barRef.current, { opacity: 1, duration: 0.3 }, '-=0.55')

      // Phase 3a — Bar rotates 90° (horizontal → vertical)
      .to(barRef.current, { rotate: 90, duration: 0.45, ease: 'power3.inOut' })

      // Phase 3b — Bar expands to full viewport height
      // After rotate(90°), scaleX scales along the visual vertical axis
      .to(barRef.current, {
        scaleX: () => window.innerHeight / 200,
        duration: 0.6,
        ease: 'power4.inOut',
      })

      // Phase 4 — Right reveals first (slides right), then left (fades)
      .to(rightCurtainRef.current, { x: '100%', duration: 0.85, ease: 'power3.inOut' })
      .to(leftCurtainRef.current, { autoAlpha: 0, duration: 0.75, ease: 'power2.inOut' }, '-=0.3')
      .to(introRef.current, { autoAlpha: 0, duration: 0.35, ease: 'power1.out' }, '-=0.55')

      // Phase 5 — Thumbnail stagger entry
      .call(() => {
        if (!col) return
        let idx = 0
        thumbRefs.current.forEach((el) => {
          if (!el) return
          const inView = el.offsetTop < col.clientHeight
          if (inView) {
            gsap.to(el, {
              clipPath: 'inset(0% 0 0 0)', opacity: 1, scale: 1,
              duration: 0.8, ease: 'power3.out', delay: idx * 0.12,
            })
            idx++
          } else {
            // Below fold: trigger on scroll
            ScrollTrigger.create({
              trigger: el,
              scroller: col,
              start: 'top 85%',
              once: true,
              onEnter: () => gsap.to(el, {
                clipPath: 'inset(0% 0 0 0)', opacity: 1, scale: 1,
                duration: 0.8, ease: 'power3.out',
              }),
            })
          }
        })
      })

    return () => {
      tl.kill()
      ScrollTrigger.getAll().forEach(t => t.kill())
    }
  }, [])

  // ── Mouse handlers ───────────────────────────────────────────────────────────
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect()
    mouseRef.current.tx = (e.clientX - r.left) / r.width
    mouseRef.current.ty = 1 - (e.clientY - r.top) / r.height
  }
  const onMouseEnter = () => { intensityRef.current.target = 1 }
  const onMouseLeave = () => { intensityRef.current.target = 0 }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .gallery-left::-webkit-scrollbar { display: none; }

        /* ── Thumbnails ─────────────────────────────────────────────────── */
        .thumb-wrap {
          position: relative;
          cursor: pointer;
          margin-bottom: 22px;
          flex-shrink: 0;
        }
        .thumb-wrap:last-child { margin-bottom: 0; }

        .thumb-inner {
          position: relative;
          width: 100%;
          overflow: hidden;
        }

        /* height: 115% gives extra pixels for parallax travel */
        .thumb-img {
          width: 100%;
          height: 115%;
          object-fit: cover;
          display: block;
          margin-top: -7.5%;
          /* CSS scale property — independent from GSAP's transform */
          transition: scale 0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .thumb-wrap:hover .thumb-img { scale: 1.04; }

        /* thumb-num is outside thumb-inner so overflow:hidden doesn't clip it */
        .thumb-num {
          position: absolute;
          left: calc(100% + 16px);
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-dm-sans, sans-serif);
          font-weight: 700;
          font-size: 10px;
          letter-spacing: 0.04em;
          color: #aaa;
          opacity: 0;
          transition: opacity 0.3s ease;
          white-space: nowrap;
          user-select: none;
        }
        .thumb-wrap:hover .thumb-num { opacity: 1; }

        .thumb-tag {
          font-family: var(--font-dm-sans, sans-serif);
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 0.01em;
          color: #555;
          margin-top: 10px;
          opacity: 0;
          transform: translateY(9px);
          transition: opacity 0.35s ease, transform 0.35s ease;
          pointer-events: none;
          user-select: none;
        }
        .thumb-wrap:hover .thumb-tag { opacity: 1; transform: translateY(0); }

        .right-title { transition: opacity 0.5s ease; }
      `}</style>

      {/* ── Intro overlay (text + bar) — z-index 100, starts WHITE ─────────── */}
      <div
        ref={introRef}
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: '#FAFAF8', pointerEvents: 'none',
        }}
      >
        {/* Centred text block */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -60%)',
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <div ref={line1Ref} style={{
            fontFamily: 'var(--font-cormorant, serif)',
            fontWeight: 300,
            fontSize: 52,
            lineHeight: 1,
            color: '#1a1a1a',
            letterSpacing: '0.01em',
            marginBottom: 14,
          }}>
            experiments. 002 — Liquid Glass
          </div>
        </div>

        {/* Bar — dark on white */}
        <div ref={barRef} style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 200, height: 3,
          background: '#1a1a1a',
          transformOrigin: 'center center',
        }} />
      </div>

      {/* ── Left curtain — white, fades to reveal left panel ─────────────────── */}
      <div ref={leftCurtainRef} style={{
        position: 'fixed', top: 0, left: 0,
        width: '50vw', height: '100vh',
        background: '#FAFAF8', zIndex: 50, pointerEvents: 'none',
      }} />

      {/* ── Right curtain — white, slides right to reveal right panel ────────── */}
      <div ref={rightCurtainRef} style={{
        position: 'fixed', top: 0, right: 0,
        width: '50vw', height: '100vh',
        background: '#FAFAF8', zIndex: 50, pointerEvents: 'none',
      }} />

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

        {/* ── Left column ───────────────────────────────────────────────────── */}
        <div
          ref={leftRef}
          className="gallery-left"
          style={{
            width: '50vw', height: '100vh',
            overflowY: 'auto', background: '#FAFAF8',
            flexShrink: 0, scrollbarWidth: 'none',
          }}
        >

          {/* Thumbnail list */}
          <div style={{
            padding: '60px 2vw 120px 2vw',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
          }}>
            {ITEMS.map((item, i) => {
              const lay = LAYOUT[i]
              return (
                <div
                  key={item.id}
                  className="thumb-wrap"
                  ref={(el) => { thumbRefs.current[i] = el }}
                  style={{ width: lay.w, marginLeft: lay.ml }}
                >
                  {/* Image container — overflow:hidden for parallax + clip */}
                  <div className="thumb-inner" style={{ height: lay.h }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="thumb-img"
                      src={item.image}
                      alt={item.title}
                      ref={(el) => { imgRefs.current[i] = el }}
                    />
                  </div>
                  {/* Number — outside thumb-inner so it isn't clipped */}
                  <span className="thumb-num">{item.number}</span>
                  <p className="thumb-tag">({item.title})</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Right column (WebGL) ───────────────────────────────────────────── */}
        <div style={{
          width: '50vw', flexShrink: 0, height: '100vh',
          background: ITEMS[activeIndex].bgColor,
          transition: 'background-color 0.8s ease',
          position: 'relative', overflow: 'hidden',
        }}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block' }}
            onMouseMove={onMouseMove}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          />

          {/* Vignette — subtle top + bottom frame */}
          <div style={{
            position: 'absolute', inset: 0,
            background: [
              'linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, transparent 28%)',
              'linear-gradient(to top,    rgba(0,0,0,0.42) 0%, transparent 38%)',
            ].join(', '),
            pointerEvents: 'none',
          }} />

          {/* ── Center editorial quote — words spread edge to edge ────────────── */}
          <div style={{
            position: 'absolute',
            top: '54%',
            left: 52, right: 52,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            pointerEvents: 'none',
          }}>
            {ITEMS[activeIndex].quote.split(' ').map((word, i) => (
              <span key={i} style={{
                fontFamily: 'var(--font-cormorant, serif)',
                fontStyle: 'italic',
                fontWeight: 300,
                fontSize: 26,
                lineHeight: 1,
                color: 'rgba(255,255,255,0.82)',
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
              }}>
                {word}
              </span>
            ))}
          </div>

          {/* ── Bottom left — hashtag label ───────────────────────────────────── */}
          <div style={{
            position: 'absolute', bottom: 34, left: 52, pointerEvents: 'none',
          }}>
            <div style={{
              fontFamily: 'var(--font-jetbrains, monospace)',
              fontSize: 8, letterSpacing: '0.18em',
              color: 'rgba(255,255,255,0.45)',
              textTransform: 'uppercase',
            }}>
              {ITEMS[activeIndex].hashtag}
            </div>
          </div>

          {/* ── Bottom right — location ───────────────────────────────────────── */}
          <div style={{
            position: 'absolute', bottom: 34, right: 52, pointerEvents: 'none',
          }}>
            <div style={{
              fontFamily: 'var(--font-jetbrains, monospace)',
              fontSize: 8, letterSpacing: '0.18em',
              color: 'rgba(255,255,255,0.45)',
              textTransform: 'uppercase',
            }}>
              {ITEMS[activeIndex].location}
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
