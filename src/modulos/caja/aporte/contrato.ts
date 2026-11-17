import type { Auditoria } from "../../../puertos/auditoria";
import type { TxDeLecturaDeCaja } from "../cobrar/contrato";
import type { RepositorioDeCorrecciones } from "../persistencia/repositorio-de-correcciones";
import type { RepositorioDeDeclaraciones } from "../persistencia/repositorio-de-declaraciones";
import type { RepositorioDeFotos } from "../persistencia/repositorio-de-fotos";
import type { RepositorioDeLaJornada } from "../persistencia/repositorio-de-la-jornada";
import type { RepositorioDeMediosDePago } from "../persistencia/repositorio-de-medios";
import type { RepositorioDeSesiones } from "../persistencia/repositorio-de-sesiones";

/**
 * Lo que lee el aporte de caja al cierre del día: todo de solo lectura, sobre la MISMA conexión que la transacción del cierre (la `Tx` que
 * pasa `cierre` y que arma la composición). `TxDeLecturaDeCaja` suma lo que ya lee el puerto de cobrar (y es lo que recibe `TicketsPorCobranza`).
 */
export type TxDeLecturaDeLaJornada = TxDeLecturaDeCaja &
  Readonly<{
    sesiones: Pick<RepositorioDeSesiones, "deLaJornada">;
    mediosDePago: Pick<RepositorioDeMediosDePago, "obtenerEfectivo">;
    correcciones: Pick<RepositorioDeCorrecciones, "deLaJornada">;
    declaraciones: Pick<
      RepositorioDeDeclaraciones,
      "declaracionesDeLaJornada" | "conformeDeLaJornada"
    >;
    laJornada: Pick<
      RepositorioDeLaJornada,
      "registradoPorPar" | "arqueosDeLaJornada" | "ajustesQueCorrigen" | "cobradoPorOrigen"
    >;
  }>;

/** Lo que usa el aporte entero: leer y congelar (la foto y su auditoría, en la transacción del cierre). */
export type TxDeAporteDeCaja = TxDeLecturaDeLaJornada &
  Readonly<{
    fotos: Pick<RepositorioDeFotos, "guardar">;
    auditoria: Auditoria;
  }>;
