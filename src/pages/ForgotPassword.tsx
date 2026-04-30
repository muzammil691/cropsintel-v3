import { useEffect } from 'react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export default function ForgotPassword() {
  useEffect(() => {
    document.title = 'Reset Password — CropsIntel'
  }, [])

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to reset it"
      footerText="Remember your password?"
      footerLink={{ to: '/login', label: 'Back to sign in' }}
    >
      <ForgotPasswordForm />
    </AuthLayout>
  )
}
