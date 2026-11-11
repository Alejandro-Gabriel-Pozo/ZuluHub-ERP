import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  validarDatosDeParte,
  type DatosDeParte,
  type EntradaDeParte,
} from "../dominio/datos-de-parte";
import { documentoNormalizado } from "../dominio/documento";
import type { Parte } from "../persistencia/modelo";
import type { ErrorDeClientes } from "./errores";

/** Lo que una parte guardada pide al validar: los datos como los escribiría la pantalla (el domicilio, estructurado o en texto). */
export function entradaDeParte(parte: Parte): EntradaDeParte {
  const d = parte.domicilio;
  return {
    naturaleza: parte.naturaleza,
    nombre: parte.nombre ?? "",
    apellido: parte.apellido,
    alias: parte.alias,
    documento:
      parte.documento === null
        ? null
        : {
            tipo: parte.documento.tipo,
            pais: parte.documento.pais,
            numero: parte.documento.numero,
          },
    condicionIva: parte.condicionIva,
    email: parte.email,
    telefono: parte.telefono,
    domicilio:
      d === null
        ? null
        : d.pais === "AR"
          ? {
              pais: "AR",
              estructurado: {
                calle: d.calle ?? "",
                numero: d.numero ?? "",
                piso: d.piso,
                departamento: d.departamento,
                localidad: d.localidad ?? "",
                provincia: d.provincia ?? "",
                codigoPostal: d.codigoPostal,
              },
            }
          : { pais: d.pais, texto: d.texto },
    nota: parte.nota,
  };
}

/** Valida la entrada y devuelve los datos o `DATOS_INVALIDOS` con un código por campo. */
export function datosValidos(entrada: EntradaDeParte): Resultado<DatosDeParte, ErrorDeClientes> {
  const valido = validarDatosDeParte(entrada);
  return valido.ok ? valido : err({ error: "DATOS_INVALIDOS", campos: valido.error });
}

/** ¿Los datos validados son los que ya tiene la parte? (la base guarda la forma canónica del dominio, así que alcanza compararla). */
export function mismosDatos(parte: Parte, datos: DatosDeParte): boolean {
  const actual = validarDatosDeParte(entradaDeParte(parte));
  return actual.ok && JSON.stringify(actual.valor) === JSON.stringify(datos);
}

/** El documento normalizado de los datos, o `null` si no tienen documento. */
export function claveDeDocumento(datos: DatosDeParte): string | null {
  return datos.documento === null ? null : documentoNormalizado(datos.documento);
}
