export function ThemeScript() {
  const code = `(()=>{try{const s=localStorage.getItem("bitbybit.theme");const d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.classList.toggle("dark",d);}catch{}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
