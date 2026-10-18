export function ThemeScript() {
  const code = `(()=>{try{const s=localStorage.getItem("bitbybit.theme");const d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.classList.toggle("dark",d);}catch{}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

/** Public Sans unless this device picked Geist Pixel. Runs before paint. */
export function FontScript() {
  const code = `(()=>{try{if(localStorage.getItem("bitbybit.font")==="geist-pixel")document.documentElement.dataset.font="geist-pixel";}catch{}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
