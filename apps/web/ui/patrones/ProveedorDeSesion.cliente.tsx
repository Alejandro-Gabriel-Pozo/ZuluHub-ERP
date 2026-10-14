"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { estadoDeSesionDePantalla } from "../../../../src/capacidades/experiencia/estado-de-sesion";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../src/capacidades/vocabulario/vocabulario";
import { AvisoDeSesion } from "./AvisoDeSesion";
import { descartarBorrador, leerBorrador } from "./borrador";
import { leerCamposDeLaPagina, restaurarCamposDeLaPagina } from "./borrador-de-pagina";
import { useActividad, type EstadoDeSesion } from "./useActividad";

/**
 * El estado de la sesión en la pantalla (armazón web §4.5): el aviso «¿Seguís ahí?» a los 12 minutos sin uso,
 * la sesión vencida que vuelve a ingresar SIN perder lo tipeado, y la renovación de la cookie mientras se usa
 * la pantalla. Lo envuelve todo el armazón de operación; el indicador de la barra superior lee el estado de acá.
 *
 * Por qué la renovación: cada pedido a una página renueva la sesión en la base, pero un componente de servidor
 * no puede fijar la cookie, y la cookie que no se renueva muere a los 15 minutos del ingreso aunque la persona
 * esté usando la aplicación. Por eso, mientras hubo uso, se pide `POST /api/sesion/renovar`, una ruta que sí
 * devuelve el `Set-Cookie`. Previene: una persona sacada de la sesión en medio de un cobro. Chequeo:
 * `ProveedorDeSesion.test.tsx` y la prueba de renovación de `test/integracion/web-sesion-y-empresa.test.ts`.
 */

const EstadoDeSesionContexto = createContext<EstadoDeSesion>("activa");

/** El estado de la sesión que calculó el proveedor más cercano (`activa` si no hay ninguno). */
export function useEstadoDeSesion(): EstadoDeSesion {
  return useContext(EstadoDeSesionContexto);
}

/** Cada cuánto se mira si hay que renovar la cookie, y cuánto puede pasar entre una renovación y la siguiente. */
const MIRAR_RENOVACION_CADA_MS = 60_000;
const RENOVAR_CADA_MS = 5 * 60_000;
const EVENTOS_DE_USO = ["pointerdown", "keydown", "touchstart"] as const;

export type PropsDeProveedorDeSesion = Readonly<{
  /** Adónde se pide la renovación (`POST`): `/api/sesion/renovar`. */
  rutaDeRenovacion: string;
  /** La pantalla de ingreso (`/ingreso`): se le agrega `?volver=<la página actual>`. */
  rutaDeIngreso: string;
  diccionario?: DiccionarioResuelto;
  children: ReactNode;
}>;

/** El nombre con que se guarda lo tipeado de una página: la ruta, sin la consulta (que puede traer datos). */
function nombreDelBorrador(): string {
  return `pagina:${window.location.pathname}`;
}

export function ProveedorDeSesion({
  rutaDeRenovacion,
  rutaDeIngreso,
  diccionario = {},
  children,
}: PropsDeProveedorDeSesion) {
  const { estado, registrarActividad, marcarVencida } = useActividad({
    calcularEstado: estadoDeSesionDePantalla,
  });
  const huboUso = useRef(false);
  const ultimaRenovacion = useRef(0);

  const renovar = useCallback(async (): Promise<"RENOVADA" | "VENCIDA" | "SIN_RESPUESTA"> => {
    try {
      const respuesta = await fetch(rutaDeRenovacion, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (respuesta.status === 401) return "VENCIDA";
      if (respuesta.ok) {
        ultimaRenovacion.current = Date.now();
        return "RENOVADA";
      }
    } catch {
      // Sin conexión: se sigue con lo que hay; la próxima vuelta lo intenta de nuevo.
    }
    return "SIN_RESPUESTA";
  }, [rutaDeRenovacion]);

  // Renovación silenciosa mientras se usa la pantalla (una vez cada 5 minutos como mucho).
  useEffect(() => {
    ultimaRenovacion.current = Date.now();
    const alUsar = () => {
      huboUso.current = true;
    };
    for (const nombre of EVENTOS_DE_USO) window.addEventListener(nombre, alUsar, true);
    const temporizador = setInterval(() => {
      if (!huboUso.current || Date.now() - ultimaRenovacion.current < RENOVAR_CADA_MS) return;
      huboUso.current = false;
      void renovar().then((resultado) => {
        if (resultado === "VENCIDA") marcarVencida();
      });
    }, MIRAR_RENOVACION_CADA_MS);
    return () => {
      for (const nombre of EVENTOS_DE_USO) window.removeEventListener(nombre, alUsar, true);
      clearInterval(temporizador);
    };
  }, [renovar, marcarVencida]);

  // Al vencer, se capturan los campos tipeados (una sola vez) para que el aviso los guarde en esta pestaña.
  const tipeado = useMemo(() => (estado === "vencida" ? leerCamposDeLaPagina() : null), [estado]);

  // Al volver de ingresar, lo guardado de esta página vuelve a los campos (y se descarta: se usa una vez).
  useEffect(() => {
    const nombre = nombreDelBorrador();
    const guardado = leerBorrador(nombre);
    if (guardado === null) return;
    restaurarCamposDeLaPagina(guardado);
    descartarBorrador(nombre);
  }, []);

  const alSeguir = useCallback(() => {
    void renovar().then((resultado) => {
      if (resultado === "VENCIDA") marcarVencida();
      else if (resultado === "RENOVADA") registrarActividad();
    });
  }, [renovar, marcarVencida, registrarActividad]);

  const alIngresar = useCallback(() => {
    const volver = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`${rutaDeIngreso}?volver=${encodeURIComponent(volver)}`);
  }, [rutaDeIngreso]);

  return (
    <EstadoDeSesionContexto value={estado}>
      {children}
      <AvisoDeSesion
        estado={estado}
        textos={{
          avisoTitulo: texto(diccionario, "sesion.aviso_titulo"),
          avisoDetalle: texto(diccionario, "sesion.aviso_detalle"),
          seguir: texto(diccionario, "sesion.seguir"),
          vencidaTitulo: texto(diccionario, "sesion.vencida_titulo"),
          vencidaDetalle: texto(diccionario, "sesion.vencida_detalle"),
          ingresarDeNuevo: texto(diccionario, "sesion.ingresar_de_nuevo"),
          cerrar: texto(diccionario, "carta.producto.cerrar"),
        }}
        alSeguir={alSeguir}
        alIngresar={alIngresar}
        {...(tipeado === null
          ? {}
          : { borrador: { nombre: nombreDelBorrador(), campos: tipeado } })}
      />
    </EstadoDeSesionContexto>
  );
}
