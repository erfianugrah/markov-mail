import { useState, useEffect } from 'react'

/**
 * Hook to compute CSS variable colors for Recharts
 * Recharts doesn't evaluate CSS variables, so we need to compute them
 */
export function useChartColor(variableName: string, darkMode: boolean): string {
  const [color, setColor] = useState('')

  useEffect(() => {
    const root = document.documentElement
    const value = getComputedStyle(root)
      .getPropertyValue(variableName)
      .trim()

    // Tailwind v4 stores HSL values as space-separated (e.g., "220 70% 65%")
    if (value) {
      setColor(`hsl(${value})`)
    } else {
      // Fallback colors
      setColor(darkMode ? 'hsl(220 70% 65%)' : 'hsl(12 76% 61%)')
    }
  }, [variableName, darkMode])

  return color
}

/**
 * Hook to get multiple chart colors at once
 */
export function useChartColors(darkMode: boolean) {
  const chart1 = useChartColor('--color-chart-1', darkMode)
  const chart2 = useChartColor('--color-chart-2', darkMode)
  const chart3 = useChartColor('--color-chart-3', darkMode)
  const chart4 = useChartColor('--color-chart-4', darkMode)
  const chart5 = useChartColor('--color-chart-5', darkMode)

  return {
    chart1,
    chart2,
    chart3,
    chart4,
    chart5
  }
}
