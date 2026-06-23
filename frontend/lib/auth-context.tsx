"use client"

import { createContext, useContext, useState, ReactNode, useEffect } from "react"
import { boxes as initialBoxes, type Box, type Capture } from "./mock-data"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"

export type AccountType = "personal" | "researcher"

export interface User {
  id: string
  name: string
  email: string
  accountType: AccountType
  institution?: string
  researchFocus?: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (userData: Partial<User> & { password: string }) => Promise<boolean>
  signOut: () => void
  boxes: Box[]
  selectedBox: Box | "all" | null
  selectBox: (box: Box | "all" | null) => void
  connectBox: (boxId: string, nickname: string) => Promise<boolean>
  captures: Capture[]
  isLoadingCaptures: boolean
  refreshCaptures: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [boxes, setBoxes] = useState<Box[]>(initialBoxes)
  const [selectedBox, setSelectedBox] = useState<Box | "all" | null>("all")
  const [captures, setCaptures] = useState<Capture[]>([])
  const [isLoadingCaptures, setIsLoadingCaptures] = useState(false)
  const [isLoadingSession, setIsLoadingSession] = useState(true)

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      if (token) {
        try {
          const res = await fetch(`${API_BASE}/me`, {
            headers: {
              Authorization: `Bearer ${token}`
            }
          })
          if (res.ok) {
            const data = await res.json()
            setUser({
              id: data.id,
              name: data.email.split("@")[0]!.replace(/[._]/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
              email: data.email,
              accountType: data.user_type === "researcher" ? "researcher" : "personal"
            })
          } else {
            localStorage.removeItem("token")
          }
        } catch (err) {
          console.error("Failed to restore session:", err)
        }
      }
      setIsLoadingSession(false)
    }
    restoreSession()
  }, [])

  // Sync default selectedBox once boxes are initialized/loaded
  useEffect(() => {
    if (boxes.length > 0 && selectedBox === "all") {
      // Keep "all" or select the first one depending on preference. Here we default to "all"
    }
  }, [boxes])

  const refreshCaptures = async () => {
    setIsLoadingCaptures(true)
    try {
      // 1. Fetch boxes from backend
      let dbBoxes: any[] = []
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
        const headers: Record<string, string> = {}
        if (token) {
          headers["Authorization"] = `Bearer ${token}`
        }
        const resBoxes = await fetch(`${API_BASE}/boxes`, { headers })
        if (resBoxes.ok) {
          const jsonBoxes = await resBoxes.json()
          dbBoxes = jsonBoxes.data || []
        }
      } catch (boxErr) {
        console.error("Failed to fetch boxes:", boxErr)
      }

      // 2. Fetch captures
      const res = await fetch(`${API_BASE}/everything`)
      if (res.ok) {
        const json = await res.json()
        const data = json.data || []
        
        const mapped: Capture[] = data.map((item: any) => {
          return {
            id: item.id,
            commonName: item.name,
            latinName: item.species || item.genus || "Unknown",
            confidence: item.confidence_score,
            boxId: item.box_id,
            boxNickname: item.box_id,
            timestamp: new Date().toISOString(),
            date: "Today",
            time: "02:14",
            imageUrl: item.image_string || "https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=400&h=300&fit=crop&q=80"
          }
        })

        // Merge initialBoxes, dbBoxes, and box_ids from captures
        setBoxes((prev) => {
          const updated = [...prev]

          // Add boxes returned by the backend /boxes endpoint
          for (const box of dbBoxes) {
            const existsIdx = updated.findIndex((b) => b.id === box.box_id_default)
            if (existsIdx === -1) {
              updated.push({
                id: box.box_id_default,
                nickname: box.box_name || `Box ${box.box_id_default}`,
                isOnline: true,
                lastSync: "Just now"
              })
            } else {
              // Update nickname if present
              if (box.box_name) {
                updated[existsIdx].nickname = box.box_name
              }
            }
          }

          // Add unique box_ids from captures
          const uniqueBoxIds = Array.from(new Set(data.map((item: any) => item.box_id))) as string[]
          for (const bid of uniqueBoxIds) {
            if (!updated.some((b) => b.id === bid)) {
              updated.push({
                id: bid,
                nickname: `Box ${bid}`,
                isOnline: true,
                lastSync: "Just now"
              })
            }
          }
          return updated
        })

        setCaptures(mapped)
      }
    } catch (err) {
      console.error("Failed to fetch captures:", err)
    } finally {
      setIsLoadingCaptures(false)
    }
  }

  useEffect(() => {
    if (user) {
      refreshCaptures()
    } else {
      setCaptures([])
    }
  }, [user])

  const signIn = async (email: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      })
      if (!res.ok) {
        throw new Error("Invalid email or password")
      }
      const data = await res.json()
      if (res.status === 200 && data.id) {
        if (data.token) {
          localStorage.setItem("token", data.token)
        }
        setUser({
          id: data.id,
          name: email.split("@")[0]!.replace(/[._]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          email,
          accountType: data.user_type === "researcher" ? "researcher" : "personal"
        })
        return true
      } else {
        throw new Error(data.msg || "Invalid credentials")
      }
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  const signUp = async (userData: Partial<User> & { password: string }): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userData.email,
          password: userData.password,
          user_type: userData.accountType || "personal",
          box_id: "" // backend signup body requirement
        })
      })
      if (!res.ok) {
        throw new Error("Failed to create account")
      }
      const data = await res.json()
      if (res.status === 200 && data.id) {
        if (data.token) {
          localStorage.setItem("token", data.token)
        }
        setUser({
          id: data.id,
          name: userData.name || userData.email!.split("@")[0]!.replace(/[._]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          email: userData.email || "",
          accountType: userData.accountType || "personal",
          institution: userData.institution,
          researchFocus: userData.researchFocus,
        })
        return true
      } else {
        throw new Error(data.msg || "Sign up failed")
      }
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  const signOut = () => {
    localStorage.removeItem("token")
    setUser(null)
  }

  const selectBox = (box: Box | "all" | null) => {
    setSelectedBox(box)
  }

  const connectBox = async (boxId: string, nickname: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/add_box`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ box_name: nickname, box_id: boxId })
      })
      if (!res.ok) {
        throw new Error(`Box registration failed with status ${res.status}`)
      }
      
      const newBox: Box = {
        id: boxId,
        nickname,
        isOnline: true,
        lastSync: "Just now",
      }
      
      setBoxes((prev) => {
        const updated = [...prev]
        const idx = updated.findIndex((b) => b.id === boxId)
        if (idx === -1) {
          updated.push(newBox)
        } else {
          updated[idx].nickname = nickname
        }
        return updated
      })
      setSelectedBox(newBox)
      await refreshCaptures()
      return true
    } catch (err) {
      console.error(err)
      return false
    }
  }

  if (isLoadingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        signIn,
        signUp,
        signOut,
        boxes,
        selectedBox,
        selectBox,
        connectBox,
        captures,
        isLoadingCaptures,
        refreshCaptures,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
