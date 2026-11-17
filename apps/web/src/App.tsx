import { Navigate, Route, Routes } from 'react-router'
import { RequireMember } from './components/RequireMember.tsx'
import { AdminPage } from './pages/AdminPage.tsx'
import { JoinPage } from './pages/JoinPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { RosterPage } from './pages/RosterPage.tsx'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route element={<RequireMember />}>
        <Route path="/" element={<Navigate to="/roster" replace />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/roster" replace />} />
    </Routes>
  )
}
