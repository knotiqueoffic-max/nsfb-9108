import { useState, useEffect, useMemo } from 'react';
import api from '../../api';

export default function TodosPage() {
  const [todos, setTodos] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, in_progress: 0, completed: 0, high_priority: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null); // null = new, object = edit
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'pending',
    due_date: '',
  });
  const [saving, setSaving] = useState(false);

  const fetchTodosAndStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const [todosRes, statsRes] = await Promise.all([
        api.get('/todos'),
        api.get('/todos/stats'),
      ]);
      setTodos(todosRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error('Failed to fetch todos:', err);
      setError(err.response?.data?.error || 'Failed to load to-do list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodosAndStats();
  }, []);

  // Filtered list
  const filteredTodos = useMemo(() => {
    return todos.filter((todo) => {
      if (statusFilter !== 'all' && todo.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && todo.priority !== priorityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = todo.title?.toLowerCase().includes(q);
        const matchesDesc = todo.description?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc) return false;
      }
      return true;
    });
  }, [todos, statusFilter, priorityFilter, searchQuery]);

  const openCreateModal = () => {
    setEditingTodo(null);
    setFormData({
      title: '',
      description: '',
      priority: 'medium',
      status: 'pending',
      due_date: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (todo) => {
    setEditingTodo(todo);
    setFormData({
      title: todo.title || '',
      description: todo.description || '',
      priority: todo.priority || 'medium',
      status: todo.status || 'pending',
      due_date: todo.due_date ? todo.due_date.substring(0, 10) : '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    try {
      setSaving(true);
      if (editingTodo) {
        await api.patch(`/todos/${editingTodo.id}`, formData);
      } else {
        await api.post('/todos', formData);
      }
      setIsModalOpen(false);
      await fetchTodosAndStats();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (todo) => {
    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
    try {
      // Optimistic update
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, status: newStatus } : t))
      );
      await api.patch(`/todos/${todo.id}`, { status: newStatus });
      const statsRes = await api.get('/todos/stats');
      setStats(statsRes.data);
    } catch (err) {
      console.error('Failed to toggle status:', err);
      fetchTodosAndStats(); // Rollback
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await api.delete(`/todos/${id}`);
      await fetchTodosAndStats();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete task');
    }
  };

  const handleClearCompleted = async () => {
    if (!window.confirm('Are you sure you want to clear all completed tasks?')) return;
    try {
      await api.delete('/todos/completed/clear');
      await fetchTodosAndStats();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to clear completed tasks');
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200">🔴 High</span>;
      case 'medium':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">🟡 Medium</span>;
      case 'low':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">🟢 Low</span>;
      default:
        return null;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Done</span>;
      case 'in_progress':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">In Progress</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            📋 Admin To-Do List
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Organize, prioritize, and track administrative tasks for your business.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stats.completed > 0 && (
            <button
              onClick={handleClearCompleted}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              🧹 Clear Completed ({stats.completed})
            </button>
          )}
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-colors flex items-center gap-2"
          >
            <span className="text-base">+</span> New To-Do
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Tasks</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/30 shadow-sm">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{stats.pending}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-blue-200 bg-blue-50/30 shadow-sm">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">In Progress</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{stats.in_progress}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/30 shadow-sm">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Completed</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{stats.completed}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-red-200 bg-red-50/30 shadow-sm col-span-2 md:col-span-1">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">High Priority</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{stats.high_priority}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto shrink-0">
          {[
            { id: 'all', label: 'All Tasks' },
            { id: 'pending', label: 'Pending' },
            { id: 'in_progress', label: 'In Progress' },
            { id: 'completed', label: 'Completed' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Priority & Search controls */}
        <div className="flex items-center gap-3">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>

          <div className="relative flex-1 md:w-60">
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <span className="absolute left-2.5 top-1.5 text-slate-400 text-xs">🔍</span>
          </div>
        </div>
      </div>

      {/* Main List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          Loading tasks...
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-2xl border border-red-200 text-sm">
          {error}
        </div>
      ) : filteredTodos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h3 className="font-bold text-slate-700 text-base">No tasks found</h3>
          <p className="text-slate-400 text-xs mt-1">
            {searchQuery || statusFilter !== 'all' || priorityFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Add your first task to get started!'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {filteredTodos.map((todo) => {
            const isDone = todo.status === 'completed';
            const isOverdue =
              todo.due_date &&
              !isDone &&
              new Date(todo.due_date).getTime() < new Date().setHours(0, 0, 0, 0);

            return (
              <div
                key={todo.id}
                className={`p-4 transition-colors hover:bg-slate-50/80 flex items-start gap-4 ${
                  isDone ? 'bg-slate-50/50' : ''
                }`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => handleToggleStatus(todo)}
                  className="mt-1 w-5 h-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3
                      className={`font-semibold text-slate-800 text-base leading-tight ${
                        isDone ? 'line-through text-slate-400' : ''
                      }`}
                    >
                      {todo.title}
                    </h3>
                    {getPriorityBadge(todo.priority)}
                    {getStatusBadge(todo.status)}
                  </div>

                  {todo.description && (
                    <p className={`text-xs text-slate-500 mt-1 whitespace-pre-line ${isDone ? 'text-slate-400' : ''}`}>
                      {todo.description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
                    {todo.due_date && (
                      <span
                        className={`flex items-center gap-1 font-medium ${
                          isOverdue ? 'text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100' : 'text-slate-500'
                        }`}
                      >
                        📅 Due: {new Date(todo.due_date).toLocaleDateString()}
                        {isOverdue && ' (Overdue)'}
                      </span>
                    )}
                    {todo.creator_name && (
                      <span>👤 Created by {todo.creator_name}</span>
                    )}
                    <span>
                      🕒 {new Date(todo.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEditModal(todo)}
                    className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                    title="Edit task"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(todo.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete task"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Dialog for Add/Edit */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">
                {editingTodo ? 'Edit Task' : 'Create New Task'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Audit low stock yarns and trigger reorder"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Add optional notes or details..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Priority
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="low">🟢 Low</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="high">🔴 High</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTodo ? 'Update Task' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
