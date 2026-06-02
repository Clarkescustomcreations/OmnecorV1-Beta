export const Slider = ({ defaultValue, max, step, className }: any) => (
  <input
    type="range"
    min="0"
    max={max}
    step={step}
    defaultValue={defaultValue?.[0]}
    className={`w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary ${className}`}
  />
)
