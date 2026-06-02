export const ScrollArea = ({ children, className }: any) => (
  <div className={`relative overflow-hidden ${className}`}>
    <div className="h-full w-full overflow-auto">
      {children}
    </div>
  </div>
)
