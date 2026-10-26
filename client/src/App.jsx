import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Materials from './pages/Materials/index'
import Products from './pages/Products/index'
import Production from './pages/Production/index'
import ProductionRequests from './pages/ProductionRequests/index'
import Workers from './pages/Workers/index'
import Orders from './pages/Orders/index'
import ReportsPage from './pages/Reports/index'
import PaymentsPage from './pages/Payments/index'
import Settings from './pages/Settings/index'
import TodosPage from './pages/Todos/index'
import ExpensesPage from './pages/Expenses/index'
import BillingPage from './pages/Billing/index'
import SuperAdminPage from './pages/SuperAdmin/index'
import PricingPage from './pages/Pricing'

function ProtectedRoute({ children, adminOnly = false, managerOnly = false }) {
  const { isAuthenticated, user } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role)
  const isManager = ['owner', 'admin', 'vendor', 'subvendor', 'super_admin'].includes(user?.role)
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  if (managerOnly && !isManager) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={isAuthenticated ? <Navigate to="/" replace /> : <Signup />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/" element={
        <ProtectedRoute>
          <Layout><Dashboard /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/materials" element={
        <ProtectedRoute adminOnly>
          <Layout><Materials /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/products" element={
        <ProtectedRoute>
          <Layout><Products /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/production" element={
        <ProtectedRoute>
          <Layout><Production /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/production-requests" element={
        <ProtectedRoute>
          <Layout><ProductionRequests /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/workers" element={
        <ProtectedRoute managerOnly>
          <Layout><Workers /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/orders" element={
        <ProtectedRoute adminOnly>
          <Layout><Orders /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/reports" element={
        <ProtectedRoute adminOnly>
          <Layout><ReportsPage /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/payments" element={
        <ProtectedRoute adminOnly>
          <Layout><PaymentsPage /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/expenses" element={
        <ProtectedRoute adminOnly>
          <Layout><ExpensesPage /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/todos" element={
        <ProtectedRoute adminOnly>
          <Layout><TodosPage /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/settings" element={
        <ProtectedRoute adminOnly>
          <Layout><Settings /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/billing" element={
        <ProtectedRoute adminOnly>
          <Layout><BillingPage /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/super-admin" element={
        <ProtectedRoute>
          <Layout><SuperAdminPage /></Layout>
        </ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
