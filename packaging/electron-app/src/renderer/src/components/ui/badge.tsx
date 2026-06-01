import React from 'react'

export const Badge = ({ children, variant, className }: any) => {
  const variants: any = {
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline: 'text-foreground border-foreground'
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variants[variant] || ''} ${className}`}>
      {children}
    </span>
  )
}
