import { Navigate, Route, Routes } from 'react-router'
import { RequireCompleteProfile } from './components/RequireCompleteProfile.tsx'
import { RequireMember } from './components/RequireMember.tsx'
import { useMe } from './hooks.ts'
import { AdminPage } from './pages/AdminPage.tsx'
import { JoinPage } from './pages/JoinPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NewTeamPage } from './pages/NewTeamPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { RosterPage } from './pages/RosterPage.tsx'
import { WelcomePage } from './pages/WelcomePage.tsx'

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
      {/* outside the gate on purpose: it is where the gate sends you, and it must not need a team */}
      <Route path="/welcome" element={<WelcomePage />} />
      {/* the gate wraps the whole app, not just the team pages: nothing is usable without a profile */}
      <Route element={<RequireCompleteProfile />}>
        <Route element={<RequireMember />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/t/:slug/roster" element={<RosterPage />} />
          <Route path="/t/:slug/admin" element={<AdminPage />} />
          {/* the data is global, but the URL carries the team so the shell cannot switch under you */}
          <Route path="/t/:slug/profile" element={<ProfilePage />} />
          <Route path="/new-team" element={<NewTeamPage />} />
        </Route>
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}
