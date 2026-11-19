import { Navigate, Route, Routes } from 'react-router'
import { RequireMember } from './components/RequireMember.tsx'
import { useMe } from './hooks.ts'
import { AdminPage } from './pages/AdminPage.tsx'
import { JoinPage } from './pages/JoinPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NewTeamPage } from './pages/NewTeamPage.tsx'
import { RosterPage } from './pages/RosterPage.tsx'

/**
 * The tenant lives in the URL: /t/<slug>/roster. `/` only decides where to send you,
 * so links are shareable and two teams can be open in two tabs.
 */
function HomeRedirect() {
  const me = useMe()

  if (me.isPending) return null
  if (!me.data?.teamSlug) return <Navigate to="/login" replace />
  return <Navigate to={`/t/${me.data.teamSlug}/roster`} replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route element={<RequireMember />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/t/:slug/roster" element={<RosterPage />} />
        <Route path="/t/:slug/admin" element={<AdminPage />} />
        <Route path="/new-team" element={<NewTeamPage />} />
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}
