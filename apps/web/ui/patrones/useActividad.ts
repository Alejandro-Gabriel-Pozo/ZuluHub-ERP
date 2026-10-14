import { useCallback, useEffect, useRef, useState } from "react";

/** Cómo está la sesión según el tiempo sin uso. Lo calcula la función pura que pasa quien arma la pantalla. */
export type EstadoDeSesion = "activa" | "por-vencer" | "vencida";

export type OpcionesDeActividad = Readonly<{
  /**
   * Decide el estado a partir de los milisegundos sin uso. Los límites (aviso, vencimiento) son del
   * llamador, no de acá: el mostrador usa 15 minutos y el aviso a los 12 (supuesto declarado), pero es
   * un parámetro, no una constante escondida. La función pura `estadoDeInactividad` de la composición
   * se adapta a esta forma.
   */
  calcularEstado: (milisegundosSinActividad: number) => EstadoDeSesion;
  /** Cada cuánto se vuelve a calcular, en milisegundos. */
  revisarCadaMs?: number;
}>;

const REVISAR_POR_DEFECTO_MS = 5000;
// Lo que cuenta como «usar la pantalla». Mover el puntero o desplazar no alcanza para dar por presente a nadie.
const EVENTOS_DE_USO = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Mide la inactividad de la pestaña. Una sesión vencida no se revive tocando la pantalla: el servidor
 * ya la cerró, así que `registrarActividad` («Seguir») solo vale mientras no venció.
 */
export function useActividad({ calcularEstado, revisarCadaMs }: OpcionesDeActividad): Readonly<{
  estado: EstadoDeSesion;
  registrarActividad: () => void;
  /** El servidor dijo que la sesión ya no vale (401): vence ahora, sin esperar al reloj de la pestaña. */
  marcarVencida: () => void;
}> {
  const [estado, setEstado] = useState<EstadoDeSesion>("activa");
  const estadoActual = useRef<EstadoDeSesion>("activa");
  const ultimoUso = useRef(0);
  const calcular = useRef(calcularEstado);

  useEffect(() => {
    calcular.current = calcularEstado;
  });

  const revisar = useCallback(() => {
    // Vencida es definitivo: el servidor ya cerró la sesión.
    if (estadoActual.current === "vencida") return;
    estadoActual.current = calcular.current(Date.now() - ultimoUso.current);
    setEstado(estadoActual.current);
  }, []);

  const marcarVencida = useCallback(() => {
    estadoActual.current = "vencida";
    setEstado("vencida");
  }, []);

  const registrarActividad = useCallback(() => {
    if (estadoActual.current === "vencida") return;
    ultimoUso.current = Date.now();
    revisar();
  }, [revisar]);

  useEffect(() => {
    // Se empieza a contar al montar.
    ultimoUso.current = Date.now();
    const alUsar = () => {
      // Con el aviso a la vista, solo «Seguir» cuenta: tocar alrededor no lo apaga.
      if (estadoActual.current === "activa") ultimoUso.current = Date.now();
    };
    for (const nombre of EVENTOS_DE_USO) window.addEventListener(nombre, alUsar, true);
    document.addEventListener("visibilitychange", revisar);
    const temporizador = setInterval(revisar, revisarCadaMs ?? REVISAR_POR_DEFECTO_MS);
    return () => {
      for (const nombre of EVENTOS_DE_USO) window.removeEventListener(nombre, alUsar, true);
      document.removeEventListener("visibilitychange", revisar);
      clearInterval(temporizador);
    };
  }, [revisar, revisarCadaMs]);

  return { estado, registrarActividad, marcarVencida };
}
