export const Select = ({ children, defaultValue, onChange }: any) => {
  return (
    <div className="relative">
      <select
        defaultValue={defaultValue}
        onChange={(e) => onChange?.(e.target.value)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
      >
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    </div>
  )
}

export const SelectTrigger = ({ children }: any) => <>{children}</>
export const SelectValue = ({ placeholder }: any) => <option value="" disabled hidden>{placeholder}</option>
export const SelectContent = ({ children }: any) => <>{children}</>
export const SelectItem = ({ value, children }: any) => <option value={value}>{children}</option>
