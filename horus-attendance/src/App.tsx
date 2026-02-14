import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider, useApp } from './contexts';
import { AppShell } from './components/layout';
import { Notification, LoadingScreen, ErrorScreen } from './components';
import {
  DashboardPage,
  SyncPage,
  RecordsPage,
  UsersPage,
  UserAttendancePage,
  ReportsPage,
  DepartmentsPage,
  SettingsPage,
} from './pages';

function AppContent() {
  const { initialized, initializing, error } = useApp();

  if (initializing) {
    return <LoadingScreen message="Initializing Horus Attendance..." />;
  }

  if (error) {
    return <ErrorScreen error={error} onRetry={() => window.location.reload()} />;
  }

  if (!initialized) {
    return <ErrorScreen error="Application failed to initialize" />;
  }

  return (
    <>
      <Notification />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="sync" element={<SyncPage />} />
            <Route path="records" element={<RecordsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/:userId/attendance" element={<UserAttendancePage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="departments" element={<DepartmentsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
