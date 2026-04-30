import { useState, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type Method = 'email' | 'google' | 'whatsapp' | 'sms'

interface Props {
  defaultMethod?: Method
  methods: Record<Method, ReactNode>
}

const LABELS: Record<Method, string> = {
  email: 'Email',
  google: 'Google',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
}

export function MethodTabs({ defaultMethod = 'email', methods }: Props) {
  const [active, setActive] = useState<Method>(defaultMethod)
  const contentRef = useRef<HTMLDivElement>(null)

  function handleMethodChange(m: Method) {
    setActive(m)
    setTimeout(() => {
      contentRef.current?.querySelector('input')?.focus()
    }, 0)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
        {(Object.keys(LABELS) as Method[]).map((m) => (
          <Button
            key={m}
            type="button"
            onClick={() => handleMethodChange(m)}
            aria-pressed={active === m}
            className={cn(
              'h-9 rounded-md text-sm font-medium transition-all shadow-none border-0',
              active === m
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm hover:bg-white dark:hover:bg-slate-950'
                : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-transparent hover:text-slate-900 dark:hover:text-slate-50',
            )}
          >
            {LABELS[m]}
          </Button>
        ))}
      </div>
      <div className="pt-2" ref={contentRef}>{methods[active]}</div>
    </div>
  )
}
