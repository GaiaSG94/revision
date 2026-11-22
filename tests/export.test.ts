import { describe, expect, it } from 'vitest'
import { statsClasse } from '../src/domain/classe'
import { construireDiagnostic } from '../src/domain/diagnostic'
import { agreger, profilVide } from '../src/domain/profil'
import { ficheEnMarkdown, nomFichierDate, profilEnCsv, statsEnCsv } from '../src/export/exports'

const id = { id: 'd1', createdAt: '2026-11-11T10:00:00.000Z' }

function jeuDeTest() {
  const diagnostic = construireDiagnostic(
    [
      { code: 'E01', ligne: '-2(3x-5)', explication: 'signe', confiance: 0.9 },
      { code: 'E01', ligne: 'autre', explication: 'signe', confiance: 0.8 },
      { code: 'E04', ligne: '1/3+1/4', explication: 'dénominateur', confiance: 0.7 },
    ],
    id,
  )
  return { profil: agreger(profilVide(), diagnostic), diagnostics: [diagnostic] }
}

describe('profile CSV export (RF-21)', () => {
  it('header, sort by frequency and total', () => {
    const csv = profilEnCsv(jeuDeTest().profil)
    const lignes = csv.split('\n')
    expect(lignes[0]).toBe('code,label,count,percent')
    expect(lignes[1]).toContain('E01')
    expect(lignes[1]).toContain('67')
    expect(lignes.at(-1)).toContain('total')
  })

  it('an empty profile does not break the export', () => {
    const csv = profilEnCsv(profilVide())
    expect(csv).not.toContain('undefined')
    expect(csv.split('\n')).toHaveLength(2)
  })
})

describe('Markdown revision sheet (RF-22)', () => {
  it('cites the dominant type and stays caring', () => {
    const { profil, diagnostics } = jeuDeTest()
    const fiche = ficheEnMarkdown(profil, diagnostics)
    expect(fiche).toContain('lost sign')
    expect(fiche.toLowerCase()).not.toContain('you made')
    expect(fiche).toContain('My recent papers')
  })

  it('empty profile: invitation message, no table', () => {
    expect(ficheEnMarkdown(profilVide(), [])).toContain('No recurring mistake')
  })
})

describe('teacher mode (RF-20)', () => {
  it('class statistic and its CSV', () => {
    const { diagnostics } = jeuDeTest()
    const stats = statsClasse([...diagnostics, ...diagnostics])
    expect(stats.nbCopies).toBe(2)
    expect(stats.typeLePlusFrequent).toBe('E01')
    expect(stats.pourcentageTypeFrequent).toBe(67)
    expect(statsEnCsv(stats).split('\n')[0]).toBe('papers,code,label,count,percent')
  })

  it('date-stamped filename', () => {
    expect(nomFichierDate('revision-profil', 'csv')).toMatch(/^revision-profil-\d{4}-\d{2}-\d{2}T.*\.csv$/)
  })
})
