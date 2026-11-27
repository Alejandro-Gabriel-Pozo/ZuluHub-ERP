import { appendFileSync } from "node:fs";
import { crearClienteVercel } from "../src/adaptadores/vercel/cliente-vercel";
import { hayEmpresaViva } from "../src/adaptadores/postgres/hay-empresa-viva";
import { leerEstadoDelAlta } from "../src/adaptadores/postgres/estado-del-alta";
import { decidirReemision } from "./ejecutar-reemitir-invitacion-de-cliente";
import { prepararSecretoDeInvitaciones } from "./ejecutar-secreto-de-invitaciones-de-cliente";

/** `npm run plataforma:secreto-de-invitaciones -- <ambiente>`; lo corre `alta-de-cliente.yml`. Ver `ejecutar-secreto-de-invitaciones-de-cliente.ts`. */
const archivo = process.env["GITHUB_ENV"];
if (archivo === undefined || archivo === "") {
  console.error("ERROR: solo corre dentro de GitHub Actions (falta GITHUB_ENV). No se hizo nada.");
  process.exit(2);
}
process.exitCode = await prepararSecretoDeInvitaciones({
  ambiente: process.argv[2],
  entorno: process.env,
  empresaExiste: hayEmpresaViva,
  // `--reemitir`: el secreto se rota aunque la empresa exista, solo si el alta está pendiente y no se invalida ninguna otra invitación.
  ...(process.argv[3] === "--reemitir"
    ? {
        modo: "reemitir" as const,
        puedeReemitir: async (cadena: string) => {
          const d = decidirReemision(await leerEstadoDelAlta(cadena));
          return d.ok ? { ok: true as const } : { ok: false as const, motivo: d.motivo };
        },
      }
    : {}),
  clienteDeVercel: (token, proyecto) => crearClienteVercel({ token, fetch, proyecto }),
  entregar: (linea) => appendFileSync(archivo, `${linea}\n`),
  info: (linea) => console.log(linea),
  error: (linea) => console.error(linea),
  comando: (linea) => console.log(linea),
});
setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
