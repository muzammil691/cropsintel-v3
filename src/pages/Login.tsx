import { useEffect } from 'react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { MethodTabs } from '@/components/auth/MethodTabs'
import { EmailLoginForm } from '@/components/auth/EmailLoginForm'
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton'
import { WhatsAppOtpForm } from '@/components/auth/WhatsAppOtpForm'
import { PhoneOtpForm } from '@/components/auth/PhoneOtpForm'

export default function Login() {
  useEffect(() => {
    document.title = 'Sign In — CropsIntel'
  }, [])

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to access market intelligence"
      footerText="Don't have an account?"
      footerLink={{ to: '/signup', label: 'Sign up' }}
    >
      <MethodTabs
        methods={{
          email: <EmailLoginForm />,
          google: (
            <div className="space-y-3">
              <GoogleLoginButton />
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                Fastest sign-in — uses your Google account
              </p>
            </div>
          ),
          whatsapp: <WhatsAppOtpForm />,
          sms: <PhoneOtpForm />,
        }}
      />
    </AuthLayout>
  )
}
