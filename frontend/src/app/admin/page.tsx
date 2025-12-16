"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const ADMIN_PASSWORD = "admin";

export default function AdminLoginPage() {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        if (password === ADMIN_PASSWORD) {
            // Store session in localStorage
            localStorage.setItem("admin_session", Date.now().toString());
            router.push("/admin/dashboard");
        } else {
            setError("Invalid password");
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen flex items-center justify-center retro-bg p-4">
            <div className="retro-container max-w-md w-full">
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-bold">🔐 Admin Console</h1>
                    <p className="text-sm text-gray-600 mt-2">Enter password to access</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="retro-input w-full"
                            placeholder="Enter admin password"
                            autoFocus
                        />
                    </div>

                    {error && (
                        <div className="retro-panel p-2 border-red-500 text-red-600 text-sm">
                            ❌ {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !password}
                        className="retro-button w-full py-3 text-lg"
                    >
                        {loading ? "Authenticating..." : "Login"}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <a href="/" className="text-sm text-blue-600 hover:underline">
                        ← Back to Markets
                    </a>
                </div>
            </div>
        </main>
    );
}
