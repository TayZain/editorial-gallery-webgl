'use client'

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// ─────────────────────────────────────────────────────────────────────────────
// GLSL — Vertex shader
// Passes UV coordinates to the fragment shader.
// ─────────────────────────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

// ─────────────────────────────────────────────────────────────────────────────
// GLSL — Fragment shader
// Renders a glass lens effect where the cursor hovers:
//   • Convex magnification  (barrel distortion toward the centre)
//   • Chromatic aberration  (RGB split that explodes at the rim)
//   • Specular highlight    (drifting point light)
//   • Bright rim glow
// ─────────────────────────────────────────────────────────────────────────────

const FRAG_SRC = `
precision mediump float;

uniform sampler2D u_image;
uniform vec2      u_mouse;
uniform float     u_time;
uniform float     u_intensity;
uniform float     u_imageAspect;
uniform float     u_canvasAspect;

varying vec2 v_uv;

// Correct UVs so the image always fills the canvas (like CSS background-size: cover)
vec2 coverUV(vec2 uv) {
  vec2 s = u_canvasAspect > u_imageAspect
    ? vec2(1.0, u_imageAspect / u_canvasAspect)
    : vec2(u_canvasAspect / u_imageAspect, 1.0);
  return (uv - 0.5) * s + 0.5;
}

void main() {
  vec2 uv = v_uv;

  // Distance from cursor, corrected for canvas aspect ratio
  vec2 aspect  = vec2(u_canvasAspect, 1.0);
  vec2 toMouse = (uv - u_mouse) * aspect;
  float dist   = length(toMouse);

  // Soft circular mask: 1 inside the lens, 0 outside
  float radius = 0.26;
  float inside = smoothstep(radius, radius - 0.012, dist);
  float strength = inside * u_intensity;

  // t = 0 at lens centre, 1 at lens rim — drives the aberration profile
  float t = clamp(dist / radius, 0.0, 1.0);

  vec2 dirScreen = normalize(toMouse + vec2(0.00001));
  vec2 dirUV     = dirScreen / aspect;

  // Convex magnification: strongest at centre (1-t²), zero at rim
  float lensMag = 0.13 * strength * (1.0 - t * t);
  vec2  lensOff = -dirUV * lensMag;

  // Chromatic aberration: almost zero at centre, explodes at rim (t²)
  float aber = 0.018 * (t * t) * inside * u_intensity;

  vec2 uvR = coverUV(uv + lensOff + dirUV * aber);
  vec2 uvG = coverUV(uv + lensOff);
  vec2 uvB = coverUV(uv + lensOff - dirUV * aber);

  float r = texture2D(u_image, uvR).r;
  float g = texture2D(u_image, uvG).g;
  float b = texture2D(u_image, uvB).b;

  // Specular: a point light that slowly orbits the lens
  float la = u_time * 0.28;
  vec2  lightDir = normalize(vec2(cos(la) * 0.35 - 0.15, sin(la) * 0.28 + 0.8));
  float nDotL = dot(normalize(-toMouse + vec2(0.00001)), lightDir);
  float spec  = pow(max(0.0, nDotL), 16.0) * inside * u_intensity * 0.28;

  // Bright rim at the edge of the lens
  float rim  = smoothstep(radius - 0.02, radius - 0.005, dist) * inside * u_intensity * 0.20;
  float glow = strength * 0.02;

  gl_FragColor = vec4(
    clamp(r + spec + rim + glow, 0.0, 1.0),
    clamp(g + spec + rim + glow, 0.0, 1.0),
    clamp(b + spec + rim + glow, 0.0, 1.0),
    1.0
  );
}
`

// ─────────────────────────────────────────────────────────────────────────────
// WebGL helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Data types & content
// ─────────────────────────────────────────────────────────────────────────────

interface GalleryItem {
  id:         number
  number:     string   // display number "01"–"10"
  title:      string   // one-word mood title
  hashtag:    string   // mono label bottom-left of right panel
  quote:      string   // italic quote spread across right panel
  location:   string   // mono label bottom-right of right panel
  image:      string   // thumbnail src
  imageLarge: string   // full WebGL texture src
  bgColor:    string   // right panel background hex
}

const ITEMS: GalleryItem[] = [
  { id: 1,  number: '01', title: 'Silence',  hashtag: 'Hastag 001', quote: 'Silence speaks in ways words cannot reach.',        location: 'Paris, FR.',        image: '/images/img1.webp',  imageLarge: '/images/img1.webp',  bgColor: '#1C1C1C' },
  { id: 2,  number: '02', title: 'Reverie',  hashtag: 'Hastag 002', quote: 'A reverie that lingers beyond morning light.',      location: 'Milan, IT.',        image: '/images/img2.webp',  imageLarge: '/images/img2.webp',  bgColor: '#A89880' },
  { id: 3,  number: '03', title: 'Absence',  hashtag: 'Hastag 003', quote: 'Beauty found only in the space left behind.',       location: 'London, UK.',       image: '/images/img3.webp',  imageLarge: '/images/img3.webp',  bgColor: '#BFB09E' },
  { id: 4,  number: '04', title: 'Longing',  hashtag: 'Hastag 004', quote: 'Distance measured not in miles but longing.',       location: 'Tokyo, JP.',        image: '/images/img4.webp',  imageLarge: '/images/img4.webp',  bgColor: '#6B5A45' },
  { id: 5,  number: '05', title: 'Lament',   hashtag: 'Hastag 005', quote: 'A lament whispered softly to the dark room.',       location: 'New York, NY.',     image: '/images/img5.webp',  imageLarge: '/images/img5.webp',  bgColor: '#2E2924' },
  { id: 6,  number: '06', title: 'Grace',    hashtag: 'Hastag 006', quote: 'Grace discovered in the unguarded still moment.',   location: 'Los Angeles, CA.',  image: '/images/img6.webp',  imageLarge: '/images/img6.webp',  bgColor: '#C8B89A' },
  { id: 7,  number: '07', title: 'Drift',    hashtag: 'Hastag 007', quote: 'To drift between worlds unseen and known.',         location: 'Seoul, KR.',        image: '/images/img7.webp',  imageLarge: '/images/img7.webp',  bgColor: '#3A3530' },
  { id: 8,  number: '08', title: 'Tender',   hashtag: 'Hastag 008', quote: 'Tenderness as armour, softness as strength.',       location: 'Copenhagen, DK.',   image: '/images/img8.webp',  imageLarge: '/images/img8.webp',  bgColor: '#D4C5B2' },
  { id: 9,  number: '09', title: 'Hollow',   hashtag: 'Hastag 009', quote: 'What remains within the hollow resonates.',         location: 'Vienna, AT.',       image: '/images/img9.webp',  imageLarge: '/images/img9.webp',  bgColor: '#1A1814' },
  { id: 10, number: '10', title: 'Vestige',  hashtag: 'Hastag 010', quote: 'Vestige of all the light once held here.',          location: 'Berlin, DE.',       image: '/images/img10.webp', imageLarge: '/images/img10.webp', bgColor: '#8C7B6A' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail layout
// Each item has a marginLeft (vw) and fixed width/height (px).
// Alternating left (~3vw) / right (~13vw) creates the editorial stagger.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if a hex color is perceptually light (W3C luminance formula). */
function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 140
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component — Right panel text overlay
// Renders the spread italic quote + bottom mono labels.
// Extracted so the main render stays readable.
// ─────────────────────────────────────────────────────────────────────────────

function RightOverlay({
  item,
  quoteColor,
  labelColor,
}: {
  item:       GalleryItem
  quoteColor: string
  labelColor: string
}) {
  return (
    <>
      {/* Quote words spread edge-to-edge (justify-content: space-between) */}
      <div style={{
        position: 'absolute',
        top: '54%',
        left: 52, right: 52,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        pointerEvents: 'none',
      }}>
        {item.quote.split(' ').map((word, i) => (
          <span key={i} style={{
            fontFamily: 'var(--font-cormorant, serif)',
            fontStyle: 'italic',
            fontWeight: 300,
            fontSize: 26,
            lineHeight: 1,
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
            color: quoteColor,
          }}>
            {word}
          </span>
        ))}
      </div>

      {/* Bottom-left mono label */}
      <div style={{ position: 'absolute', bottom: 34, left: 52, pointerEvents: 'none' }}>
        <span style={{
          fontFamily: 'var(--font-jetbrains, monospace)',
          fontSize: 8,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: labelColor,
        }}>
          {item.hashtag}
        </span>
      </div>

      {/* Bottom-right mono label */}
      <div style={{ position: 'absolute', bottom: 34, right: 52, pointerEvents: 'none' }}>
        <span style={{
          fontFamily: 'var(--font-jetbrains, monospace)',
          fontSize: 8,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: labelColor,
        }}>
          {item.location}
        </span>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function Intro() {
  const [activeIndex, setActiveIndex] = useState(0)

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const leftColRef    = useRef<HTMLDivElement>(null)
  const thumbRefs     = useRef<(HTMLDivElement | null)[]>([])
  const imgRefs       = useRef<(HTMLImageElement | null)[]>([])
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)  // used for smooth intro reveal

  // ── WebGL state (mutable refs — no re-renders needed) ──────────────────────
  const glRef          = useRef<WebGLRenderingContext | null>(null)
  const textureRef     = useRef<WebGLTexture | null>(null)
  const uniformsRef    = useRef<Record<string, WebGLUniformLocation | null>>({})
  const mouseRef       = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 })
  const intensityRef   = useRef({ current: 0, target: 0 })
  const imageAspectRef = useRef(1)
  const rafRef         = useRef<number>(0)

  // ── Intro animation refs ────────────────────────────────────────────────────
  const introRef        = useRef<HTMLDivElement>(null)
  const line1Ref        = useRef<HTMLDivElement>(null)
  const barRef          = useRef<HTMLDivElement>(null)
  const leftCurtainRef  = useRef<HTMLDivElement>(null)
  const rightCurtainRef = useRef<HTMLDivElement>(null)

  // ── Active thumbnail tracker ─────────────────────────────────────────────────
  // Finds the thumbnail whose centre is closest to the column's midpoint.
  useEffect(() => {
    const col = leftColRef.current
    if (!col) return

    const onScroll = () => {
      const mid = col.scrollTop + col.clientHeight / 2
      let best = 0, bestDist = Infinity

      thumbRefs.current.forEach((el, i) => {
        if (!el) return
        const dist = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid)
        if (dist < bestDist) { bestDist = dist; best = i }
      })

      setActiveIndex(best)
    }

    col.addEventListener('scroll', onScroll, { passive: true })
    return () => col.removeEventListener('scroll', onScroll)
  }, [])

  // ── WebGL setup ──────────────────────────────────────────────────────────────
  // Initialises the GL context, compiles shaders, creates the fullscreen quad,
  // and starts the render loop. Runs once on mount.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return
    glRef.current = gl

    const prog = buildProgram(gl, VERT_SRC, FRAG_SRC)
    if (!prog) return

    // Fullscreen quad: two triangles covering clip space [-1,1]
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(prog, 'a_position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    uniformsRef.current = {
      u_image:       gl.getUniformLocation(prog, 'u_image'),
      u_mouse:       gl.getUniformLocation(prog, 'u_mouse'),
      u_time:        gl.getUniformLocation(prog, 'u_time'),
      u_intensity:   gl.getUniformLocation(prog, 'u_intensity'),
      u_imageAspect: gl.getUniformLocation(prog, 'u_imageAspect'),
      u_canvasAspect:gl.getUniformLocation(prog, 'u_canvasAspect'),
    }

    gl.useProgram(prog)
    gl.uniform1i(uniformsRef.current.u_image, 0)

    // Placeholder 1×1 black texture until the first image loads
    const tex = gl.createTexture()!
    textureRef.current = tex
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    // Resize canvas to match physical pixels (respects devicePixelRatio, capped at 2×)
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width  = canvas.clientWidth  * dpr
      canvas.height = canvas.clientHeight * dpr
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)

    // Render loop — lerps mouse position and intensity for smooth response
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
      gl.uniform2f(u.u_mouse,        m.x, m.y)
      gl.uniform1f(u.u_time,         elapsed)
      gl.uniform1f(u.u_intensity,    inten.current)
      gl.uniform1f(u.u_imageAspect,  imageAspectRef.current)
      gl.uniform1f(u.u_canvasAspect, canvas.width / canvas.height)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // ── Texture update ───────────────────────────────────────────────────────────
  // Uploads the active item's image as a WebGL texture whenever activeIndex changes.
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

  // ── Intro sequence + scroll animations ──────────────────────────────────────
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const col = leftColRef.current

    // ── Initial hidden states ──────────────────────────────────────────────
    thumbRefs.current.forEach(el => {
      if (el) gsap.set(el, { clipPath: 'inset(100% 0 0 0)', opacity: 0, scale: 0.92 })
    })
    // Right panel starts invisible; it will fade in during the reveal (Phase 4)
    gsap.set(rightPanelRef.current, { autoAlpha: 0, y: 28 })

    // ── Parallax on each thumbnail image ──────────────────────────────────
    // Image travels 40px total (–20 → +20) over the full scroll range of its wrapper.
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
              end:   'bottom top',
              scrub: true,
            },
          }
        )
      })
    }

    // ── Respect prefers-reduced-motion ────────────────────────────────────
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      gsap.set([introRef.current, leftCurtainRef.current, rightCurtainRef.current], { autoAlpha: 0 })
      gsap.set(rightPanelRef.current, { autoAlpha: 1, y: 0 })
      thumbRefs.current.forEach(el => {
        if (el) gsap.set(el, { clipPath: 'inset(0% 0 0 0)', opacity: 1, scale: 1 })
      })
      return
    }

    // ── Bar initial state (GSAP owns the transform — no CSS translate) ────
    gsap.set(barRef.current,  { xPercent: -50, yPercent: -50, opacity: 0 })
    gsap.set(line1Ref.current, { opacity: 0, y: 22 })

    // ── Intro timeline ────────────────────────────────────────────────────
    const tl = gsap.timeline()

    tl
      // Phase 1 — Title drifts up into view
      .to(line1Ref.current, { opacity: 1, y: 0, duration: 0.65, ease: 'power2.out' })
      .to({}, { duration: 1.0 }) // brief pause so the user can read it

      // Phase 2 — Title parallax-exits upward; bar fades in behind it
      .to(line1Ref.current, { y: -38, opacity: 0, duration: 0.9, ease: 'sine.inOut' })
      .to(barRef.current,   { opacity: 1, duration: 0.3 }, '-=0.55')

      // Phase 3 — Bar rotates 90° then expands to full viewport height
      // After rotate(90°) scaleX is the visual vertical axis, so we scale to vh/barWidth
      .to(barRef.current, { rotate: 90, duration: 0.45, ease: 'power3.inOut' })
      .to(barRef.current, {
        scaleX: () => window.innerHeight / 200,
        duration: 0.6,
        ease: 'power4.inOut',
      })

      // Phase 4 — Right curtain slides away first, content rises in simultaneously
      //           Then left curtain fades + intro overlay disappears
      .to(rightCurtainRef.current, { x: '100%', duration: 0.85, ease: 'power3.inOut' })
      .to(rightPanelRef.current,   { autoAlpha: 1, y: 0, duration: 1.0, ease: 'power2.out' }, '-=0.75')
      .to(leftCurtainRef.current,  { autoAlpha: 0, duration: 0.75, ease: 'power2.inOut' }, '-=0.45')
      .to(introRef.current,        { autoAlpha: 0, duration: 0.35, ease: 'power1.out' },    '-=0.55')

      // Phase 5 — Thumbnails stagger in; below-fold ones trigger on scroll
      .call(() => {
        if (!col) return
        let staggerIdx = 0

        thumbRefs.current.forEach(el => {
          if (!el) return
          const isInView = el.offsetTop < col.clientHeight

          if (isInView) {
            gsap.to(el, {
              clipPath: 'inset(0% 0 0 0)', opacity: 1, scale: 1,
              duration: 0.8, ease: 'power3.out', delay: staggerIdx * 0.12,
            })
            staggerIdx++
          } else {
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

  // ── Mouse handlers for the WebGL canvas ──────────────────────────────────────
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    mouseRef.current.tx = (e.clientX - rect.left) / rect.width
    mouseRef.current.ty = 1 - (e.clientY - rect.top) / rect.height  // flip Y for GL coords
  }
  const onMouseEnter = () => { intensityRef.current.target = 1 }
  const onMouseLeave = () => { intensityRef.current.target = 0 }

  // ── Derived text colors for the right panel ───────────────────────────────────
  // Switches between dark and light text depending on the background luminance.
  const light      = isLight(ITEMS[activeIndex].bgColor)
  const quoteColor = light ? 'rgba(10,10,10,0.82)' : 'rgba(255,255,255,0.82)'
  const labelColor = light ? 'rgba(10,10,10,0.50)' : 'rgba(255,255,255,0.45)'

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        /* Hide scrollbar while keeping scroll functionality */
        .gallery-left::-webkit-scrollbar { display: none; }

        /* ── Thumbnail card ─────────────────────────────────────────────── */
        .thumb-wrap {
          position: relative;
          cursor: pointer;
          margin-bottom: 22px;
          flex-shrink: 0;
        }
        .thumb-wrap:last-child { margin-bottom: 0; }

        /* Clip container — overflow:hidden is what makes parallax + reveal work */
        .thumb-inner {
          position: relative;
          width: 100%;
          overflow: hidden;
        }

        /*
          Image is 115% tall so it can travel ±20px without showing empty space.
          CSS "scale" property is used for hover (separate from transform)
          so GSAP's translateY parallax doesn't conflict.
        */
        .thumb-img {
          width: 100%;
          height: 115%;
          object-fit: cover;
          display: block;
          margin-top: -7.5%;
          transition: scale 0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .thumb-wrap:hover .thumb-img { scale: 1.04; }

        /* Index number — sits outside .thumb-inner to avoid being clipped */
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

        /* Mood title below the image */
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
      `}</style>

      {/* ── Intro overlay ─────────────────────────────────────────────────────
          White full-screen cover that hides everything during the intro.
          Contains the title text and the expanding bar. z-index 100 = on top. */}
      <div ref={introRef} style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: '#FAFAF8', pointerEvents: 'none',
      }}>
        {/* Centred title */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -60%)',
          textAlign: 'center',
        }}>
          <div ref={line1Ref} style={{
            fontFamily: 'var(--font-cormorant, serif)',
            fontWeight: 300,
            fontSize: 52,
            lineHeight: 1,
            letterSpacing: '0.01em',
            color: '#1a1a1a',
          }}>
            experiments. 002 — Liquid Glass
          </div>
        </div>

        {/* Expanding bar — GSAP manages its transform, no CSS transform here */}
        <div ref={barRef} style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 200, height: 3,
          background: '#1a1a1a',
          transformOrigin: 'center center',
        }} />
      </div>

      {/* ── Curtains ──────────────────────────────────────────────────────────
          Two white panels that cover the split-screen during the intro.
          Right curtain slides out first; left curtain fades after. */}
      <div ref={leftCurtainRef} style={{
        position: 'fixed', top: 0, left: 0,
        width: '50vw', height: '100vh',
        background: '#FAFAF8', zIndex: 50, pointerEvents: 'none',
      }} />
      <div ref={rightCurtainRef} style={{
        position: 'fixed', top: 0, right: 0,
        width: '50vw', height: '100vh',
        background: '#FAFAF8', zIndex: 50, pointerEvents: 'none',
      }} />

      {/* ── Split-screen layout ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

        {/* ── Left column — scrollable thumbnail list ──────────────────────── */}
        <div
          ref={leftColRef}
          className="gallery-left"
          style={{
            width: '50vw', height: '100vh',
            overflowY: 'auto', background: '#FAFAF8',
            flexShrink: 0, scrollbarWidth: 'none',
          }}
        >
          <div style={{
            padding: '60px 2vw 120px calc(4vw + 40px)',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
          }}>
            {ITEMS.map((item, i) => {
              const lay = LAYOUT[i]
              return (
                <div
                  key={item.id}
                  className="thumb-wrap"
                  ref={el => { thumbRefs.current[i] = el }}
                  style={{ width: lay.w, marginLeft: lay.ml }}
                >
                  {/* Clip wrapper — overflow:hidden clips the parallax-shifted image */}
                  <div className="thumb-inner" style={{ height: lay.h }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="thumb-img"
                      src={item.image}
                      alt={item.title}
                      ref={el => { imgRefs.current[i] = el }}
                    />
                  </div>
                  <span className="thumb-num">{item.number}</span>
                  <p className="thumb-tag">({item.title})</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Right column — WebGL glass panel ─────────────────────────────── */}
        <div
          ref={rightPanelRef}
          style={{
            width: '50vw', flexShrink: 0, height: '100vh',
            background: ITEMS[activeIndex].bgColor,
            transition: 'background-color 0.8s ease',
            position: 'relative', overflow: 'hidden',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block' }}
            onMouseMove={onMouseMove}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          />

          {/* Vignette gradient — frames the image top and bottom */}
          <div style={{
            position: 'absolute', inset: 0,
            background: [
              'linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, transparent 28%)',
              'linear-gradient(to top,    rgba(0,0,0,0.42) 0%, transparent 38%)',
            ].join(', '),
            pointerEvents: 'none',
          }} />

          {/* Quote + labels — colour adapts to light/dark background */}
          <RightOverlay
            item={ITEMS[activeIndex]}
            quoteColor={quoteColor}
            labelColor={labelColor}
          />
        </div>

      </div>
    </>
  )
}
