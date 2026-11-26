"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { armarLosTextosDeImprimir } from "../../patrones/papel/textos-de-imprimir";
import { ImpresionDelDocumento, type AccionesDeImpresion } from "./ImpresionDelDocumento.cliente";
import type { CocinaArmada } from "./modelo-de-la-cocina";
import estilos from "./PantallaDeLaMesa.module.css";

export type PropsDePantallaDeLaCocina = Readonly<{
  cocina: CocinaArmada;
  /** Los textos de imprimir ya resueltos (los aprobados de `comandas.texto.imprimir_*`). */
  textos: ReturnType<typeof armarLosTextosDeImprimir>;
  acciones: AccionesDeImpresion;
  /** Sin permiso para imprimir el botón sale apagado (solo una ayuda: el servidor decide). */
  puedeImprimir: boolean;
  /** El enlace «Configurar impresoras» (solo a quien puede ir); `null` si no se ofrece. */
  configurarImpresoras: ReactNode;
}>;

/**
 * La pantalla de la cocina (SAL-H; maqueta aprobada por el dueño el 25/11/2026): los envíos de la sucursal cuyo papel espera o falló, para imprimirlos desde la PC o tablet de la cocina sin depender del celular del mozo.
 *  - **Un trabajo, un papel.** Cada fila usa el MISMO botón de imprimir que la ficha de la mesa: «Imprimir» abre el diálogo del sistema con el trabajo que ya creó el envío, y lo que falló arranca en «No se pudo imprimir»
 *    con «Reintentar» (el mismo trabajo con un intento más). Tocar dos veces no saca dos papeles; dos PC de cocina sobre el mismo envío terminan en un solo trabajo (lo garantiza el servidor).
 *  - **Se actualiza al abrir y al volver a la pestaña**, nunca por tiempo (decisión técnica del orquestador): el navegador no avisa cuándo cambia otra PC, y refrescar solo borraría el «Impresa» recién logrado.
 *  - **Límite conocido:** el navegador no confirma que el papel salió; «Impresa» es lo que declara el diálogo. Sin texto de lista vacía (P-S5): sin nada pendiente la lista queda vacía.
 * Sin textos propios: todos llegan resueltos. Chequeo: `PantallaDeLaCocina.test.tsx` (Chromium real: axe, doble toque, reintento, volver a la pestaña).
 */
export function PantallaDeLaCocina({
  cocina,
  textos,
  acciones,
  puedeImprimir,
  configurarImpresoras,
}: PropsDePantallaDeLaCocina) {
  const router = useRouter();
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [router]);

  return (
    <div className={estilos["raiz"]}>
      <ul className={estilos["platos"]}>
        {cocina.filas.map((f) => (
          <li key={f.envioId} className={estilos["plato"]}>
            <div className={estilos["datos"]}>
              <strong>{f.titulo}</strong>
              <span className={estilos["nota"]}>{f.detalle}</span>
            </div>
            <ImpresionDelDocumento
              documento={{
                clave: `${f.envioId}:${f.estado}`,
                tipo: "COMANDA",
                documentoId: f.envioId,
                trabajoId: f.trabajoId,
                titulo: `${f.titulo} · ${f.detalle}`,
                sinImpresora: f.sinImpresora,
                copia: false,
                intentos: f.intentos,
              }}
              textos={textos}
              textoDeLaCopia={textos.imprimir}
              acciones={acciones}
              deshabilitado={!puedeImprimir}
              configurarImpresoras={configurarImpresoras}
              arrancarSolo={false}
              empezarFallida={f.estado === "FALLIDA"}
              mostrarTitulo={false}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
