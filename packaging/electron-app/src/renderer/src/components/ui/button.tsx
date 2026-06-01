import React from 'react'

export const Button = ({ children, onClick, disabled, variant, className }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 ${
      variant === 'ghost' ? 'hover:bg-accent hover:text-accent-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90'
    } ${className}`}
  >
    {children}
  </button>
)
