'use client'

import { createContext, useContext, useState, useCallback } from 'react'

interface CartItem {
  id: string
  name: string
  price: number
  qty: number
}

interface CartCtx {
  items: CartItem[]
  count: number
  addItem: (id: string, name: string, price: number) => void
}

const CartContext = createContext<CartCtx>({
  items: [],
  count: 0,
  addItem: () => {},
})

export const useCart = () => useContext(CartContext)

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  const addItem = useCallback((id: string, name: string, price: number) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === id)
      if (existing) {
        return prev.map((i) => (i.id === id ? { ...i, qty: i.qty + 1 } : i))
      }
      return [...prev, { id, name, price, qty: 1 }]
    })
  }, [])

  const count = items.reduce((sum, i) => sum + i.qty, 0)

  return (
    <CartContext.Provider value={{ items, count, addItem }}>
      {children}
    </CartContext.Provider>
  )
}
