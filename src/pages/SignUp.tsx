import { useEffect } from 'react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { MethodTabs } from '@/components/auth/MethodTabs'
import { EmailSignUpForm } from '@/components/auth/EmailSignUpForm'
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton'
import { WhatsAppOtpForm } from '@/components/auth/WhatsAppOtpForm'
import { PhoneOtpForm } from '@/components/auth/PhoneOtpForm'

export default function SignUp() {
  useEffect(() => {
    document.title = 'Create Account — CropsIntel'
  }, [])

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join CropsIntel to access almond market intelligence"
      footerText="Already have an account?"
      footerLink={{ to: '/login', label: 'Sign in' }}
    >
      <MethodTabs
        methods={{
          email: <EmailSignUpForm />,
          google: (
            <div className="space-y-3">
              <GoogleLoginButton />
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                Sign up instantly with your Google account
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
