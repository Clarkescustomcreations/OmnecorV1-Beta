export const RadioGroup = ({ children, className }: any) => (
  <div className={`grid gap-2 ${className}`}>
    {children}
  </div>
)

export const RadioGroupItem = ({ id, value, className }: any) => (
  <input
    type="radio"
    id={id}
    value={value}
    className={`aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
  />
)
