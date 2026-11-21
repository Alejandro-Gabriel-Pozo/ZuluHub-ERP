import { SoloLector } from "../../primitivas/SoloLector";
import estilos from "./PantallaDelCierre.module.css";

const PASOS = [1, 2, 3] as const;

/**
 * Los puntos numerados 1 · 2 · 3 de los pasos del cierre (maqueta aceptada, sin texto de paso: «Paso 1 de 3» no se aprobó, DDD:183). El actual va lleno y marcado con `aria-current="step"`,
 * los hechos con tilde; el número es el texto accesible de cada punto: el estado nunca se dice solo con color.
 */
export function PuntosDelCierre({ actual }: Readonly<{ actual: 1 | 2 | 3 }>) {
  return (
    <ol className={estilos["puntos"]}>
      {PASOS.map((n) => {
        const estado = n < actual ? "hecho" : n === actual ? "ahora" : "pendiente";
        return (
          <li
            key={n}
            className={estilos["punto"]}
            data-estado={estado}
            aria-current={estado === "ahora" ? "step" : undefined}
          >
            <span className={estilos["numero"]} aria-hidden="true">
              {estado === "hecho" ? "✓" : n}
            </span>
            <SoloLector>{String(n)}</SoloLector>
          </li>
        );
      })}
    </ol>
  );
}
