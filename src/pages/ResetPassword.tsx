import { useEffect } from 'react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export default function ResetPassword() {
  useEffect(() => {
    document.title = 'Set New Password — CropsIntel'
  }, [])

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a strong password for your account"
      footerText="Back to"
      footerLink={{ to: '/login', label: 'Sign in' }}
    >
      <ResetPasswordForm />
    </AuthLayout>
  )
}
