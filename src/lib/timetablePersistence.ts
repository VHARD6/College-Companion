import { supabase } from './supabase.ts'
import { syncMasterTimetableToSlots } from './timetableSyncAdapter.ts'
import type {
  MasterTimetable,
  MasterTimetablePeriod,
  MasterTimetableColumn,
  MasterTimetableEntry,
  MasterTimetableSubentry,
} from '../types/timetableStudio.ts'

export type MasterTimetableDraftInput = {
  id?: number
  title: string
  academic_year: string
  semester: number
  cohort: string
  effective_date: string
  status?: 'draft' | 'published' | 'archived'
  version?: number
  header_title?: string | null
  header_subtitle?: string | null
  footer_notes?: string | null
  periods: MasterTimetablePeriod[]
  columns: MasterTimetableColumn[]
  entries: MasterTimetableEntry[]
}

/**
 * Fetch list of master timetables for admin overview/selector.
 */
export async function fetchMasterTimetablesList(
  client: any = supabase,
  filter?: { status?: 'draft' | 'published' | 'archived'; semester?: number }
): Promise<MasterTimetable[]> {
  let query = client
    .from('master_timetables')
    .select(`
      id,
      title,
      academic_year,
      semester,
      cohort,
      effective_date,
      status,
      version,
      header_title,
      header_subtitle,
      footer_notes,
      published_png_url,
      created_by,
      published_at,
      created_at
    `)
    .order('created_at', { ascending: false })

  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  if (filter?.semester) {
    query = query.eq('semester', filter.semester)
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/**
 * Fetch a complete master timetable with all periods, columns, entries, and subentries.
 */
export async function fetchMasterTimetableById(
  timetableId: number,
  client: any = supabase
): Promise<MasterTimetable | null> {
  // 1. Fetch timetable metadata
  const { data: meta, error: metaErr } = await client
    .from('master_timetables')
    .select('*')
    .eq('id', timetableId)
    .maybeSingle()

  if (metaErr) throw metaErr
  if (!meta) return null

  // 2. Fetch periods
  const { data: periodsData, error: pErr } = await client
    .from('master_timetable_periods')
    .select('*')
    .eq('timetable_id', timetableId)
    .order('period_order', { ascending: true })

  if (pErr) throw pErr
  const periods: MasterTimetablePeriod[] = periodsData ?? []

  // 3. Fetch columns
  const { data: columnsData, error: cErr } = await client
    .from('master_timetable_columns')
    .select('*, classes(id, name, semester, academic_year)')
    .eq('timetable_id', timetableId)
    .order('column_order', { ascending: true })

  if (cErr) throw cErr
  const columns: MasterTimetableColumn[] = columnsData ?? []

  // 4. Fetch entries
  const { data: entriesData, error: eErr } = await client
    .from('master_timetable_entries')
    .select('*')
    .eq('timetable_id', timetableId)

  if (eErr) throw eErr
  const rawEntries = entriesData ?? []

  // 5. Fetch subentries for all entries
  const entryIds = rawEntries.map((e: any) => e.id)
  let subentriesByEntryId = new Map<number, MasterTimetableSubentry[]>()

  if (entryIds.length > 0) {
    const { data: subData, error: subErr } = await client
      .from('master_timetable_subentries')
      .select(`
        *,
        subjects(id, name, code, type),
        professors(id, user_id, department_id, abbreviation),
        batches(id, name, class_id)
      `)
      .in('entry_id', entryIds)

    if (subErr) throw subErr

    for (const sub of (subData ?? [])) {
      if (!subentriesByEntryId.has(sub.entry_id)) {
        subentriesByEntryId.set(sub.entry_id, [])
      }
      subentriesByEntryId.get(sub.entry_id)!.push({
        id: sub.id,
        entry_id: sub.entry_id,
        subject_id: sub.subject_id,
        professor_id: sub.professor_id,
        batch_id: sub.batch_id,
        room: sub.room,
        subject: sub.subjects,
        professor: sub.professors,
        batch: sub.batches,
      })
    }
  }

  const entries: MasterTimetableEntry[] = rawEntries.map((e: any) => ({
    id: e.id,
    timetable_id: e.timetable_id,
    weekday: e.weekday,
    start_period_id: e.start_period_id,
    end_period_id: e.end_period_id,
    column_id: e.column_id,
    entry_type: e.entry_type,
    common_break_label: e.common_break_label,
    subentries: subentriesByEntryId.get(e.id) ?? [],
  }))

  return {
    ...meta,
    periods,
    columns,
    entries,
  }
}

/**
 * Fetch the published master timetable for a student's class.
 * Enforces status = 'published'.
 */
export async function fetchPublishedMasterTimetableForStudent(
  classId: number,
  semester?: number,
  client: any = supabase
): Promise<MasterTimetable | null> {
  // Query columns joined to master_timetables where class_id matches and status = 'published'
  let query = client
    .from('master_timetable_columns')
    .select(`
      timetable_id,
      master_timetables!inner(
        id,
        status,
        semester,
        version,
        published_at
      )
    `)
    .eq('class_id', classId)
    .eq('master_timetables.status', 'published')

  if (semester) {
    query = query.eq('master_timetables.semester', semester)
  }

  const { data, error } = await query
  if (error) throw error
  if (!data || data.length === 0) return null

  // Sort by version descending, then published_at descending
  const sorted = [...data].sort((a: any, b: any) => {
    const vA = a.master_timetables?.version ?? 0
    const vB = b.master_timetables?.version ?? 0
    if (vB !== vA) return vB - vA
    const tA = new Date(a.master_timetables?.published_at || 0).getTime()
    const tB = new Date(b.master_timetables?.published_at || 0).getTime()
    return tB - tA
  })

  const targetTimetableId = sorted[0].timetable_id
  return fetchMasterTimetableById(targetTimetableId, client)
}

/**
 * Persist an admin timetable draft to Supabase.
 * Atomically creates or updates master_timetables and its child tables.
 */
export async function saveMasterTimetableDraft(
  draft: MasterTimetableDraftInput,
  client: any = supabase,
  userProfileId?: string
): Promise<MasterTimetable> {
  let timetableId = draft.id

  // 1. Insert or update master_timetables parent row
  if (timetableId) {
    const { error: updateErr } = await client
      .from('master_timetables')
      .update({
        title: draft.title,
        academic_year: draft.academic_year,
        semester: draft.semester,
        cohort: draft.cohort,
        effective_date: draft.effective_date,
        header_title: draft.header_title ?? null,
        header_subtitle: draft.header_subtitle ?? null,
        footer_notes: draft.footer_notes ?? null,
      })
      .eq('id', timetableId)

    if (updateErr) throw updateErr

    // Delete existing entries (cascades to subentries) to prepare for re-sync
    const { error: delEntriesErr } = await client
      .from('master_timetable_entries')
      .delete()
      .eq('timetable_id', timetableId)

    if (delEntriesErr) throw delEntriesErr

    // Delete existing columns and periods
    const { error: delColErr } = await client
      .from('master_timetable_columns')
      .delete()
      .eq('timetable_id', timetableId)
    if (delColErr) throw delColErr

    const { error: delPerErr } = await client
      .from('master_timetable_periods')
      .delete()
      .eq('timetable_id', timetableId)
    if (delPerErr) throw delPerErr
  } else {
    const { data: newRow, error: insertErr } = await client
      .from('master_timetables')
      .insert({
        title: draft.title,
        academic_year: draft.academic_year,
        semester: draft.semester,
        cohort: draft.cohort,
        effective_date: draft.effective_date,
        status: 'draft',
        version: draft.version || 1,
        header_title: draft.header_title ?? null,
        header_subtitle: draft.header_subtitle ?? null,
        footer_notes: draft.footer_notes ?? null,
        created_by: userProfileId || null,
      })
      .select('id')
      .single()

    if (insertErr) throw insertErr
    timetableId = newRow.id
  }

  // 2. Insert Periods and build ID mapping
  // Map client/transient period ID -> persisted database period ID
  const periodIdMap = new Map<number, number>()
  if (draft.periods.length > 0) {
    const periodPayload = draft.periods.map(p => ({
      timetable_id: timetableId,
      period_order: p.period_order,
      start_time: p.start_time,
      end_time: p.end_time,
      is_break: p.is_break,
      break_label: p.break_label ?? null,
    }))

    const { data: savedPeriods, error: pSaveErr } = await client
      .from('master_timetable_periods')
      .insert(periodPayload)
      .select('id, period_order')

    if (pSaveErr) throw pSaveErr

    // Map by period_order since period_order is unique per timetable
    const savedPeriodByOrder = new Map<number, number>(
      (savedPeriods ?? []).map((sp: any) => [sp.period_order, sp.id])
    )

    draft.periods.forEach(p => {
      const dbId = savedPeriodByOrder.get(p.period_order)
      if (dbId) {
        periodIdMap.set(p.id, dbId)
      }
    })
  }

  // 3. Insert Columns and build ID mapping
  const columnIdMap = new Map<number, number>()
  if (draft.columns.length > 0) {
    const columnPayload = draft.columns.map(c => ({
      timetable_id: timetableId,
      class_id: c.class_id,
      column_order: c.column_order,
      display_label: c.display_label,
    }))

    const { data: savedColumns, error: cSaveErr } = await client
      .from('master_timetable_columns')
      .insert(columnPayload)
      .select('id, class_id')

    if (cSaveErr) throw cSaveErr

    const savedColByClass = new Map<number, number>(
      (savedColumns ?? []).map((sc: any) => [sc.class_id, sc.id])
    )

    draft.columns.forEach(c => {
      const dbId = savedColByClass.get(c.class_id)
      if (dbId) {
        columnIdMap.set(c.id, dbId)
      }
    })
  }

  // 4. Insert Entries & Subentries
  for (const entry of draft.entries) {
    const dbStartPeriodId = periodIdMap.get(entry.start_period_id) ?? entry.start_period_id
    const dbEndPeriodId = periodIdMap.get(entry.end_period_id) ?? entry.end_period_id
    const dbColumnId = entry.column_id ? (columnIdMap.get(entry.column_id) ?? entry.column_id) : null

    const { data: savedEntry, error: entryErr } = await client
      .from('master_timetable_entries')
      .insert({
        timetable_id: timetableId,
        weekday: entry.weekday,
        start_period_id: dbStartPeriodId,
        end_period_id: dbEndPeriodId,
        column_id: dbColumnId,
        entry_type: entry.entry_type,
        common_break_label: entry.common_break_label ?? null,
      })
      .select('id')
      .single()

    if (entryErr) throw entryErr

    // Insert subentries
    if (entry.subentries && entry.subentries.length > 0) {
      const subPayload = entry.subentries.map(sub => ({
        entry_id: savedEntry.id,
        subject_id: sub.subject_id,
        professor_id: sub.professor_id,
        batch_id: sub.batch_id ?? null,
        room: sub.room ?? null,
      }))

      const { error: subErr } = await client
        .from('master_timetable_subentries')
        .insert(subPayload)

      if (subErr) throw subErr
    }
  }

  const loaded = await fetchMasterTimetableById(timetableId!, client)
  if (!loaded) throw new Error('Failed to reload saved timetable')
  return loaded
}

/**
 * Publish a master timetable.
 * Sets status to 'published', updates published_at, and syncs to timetable_slots.
 */
export async function publishMasterTimetable(
  timetableId: number,
  client: any = supabase
): Promise<{ timetable: MasterTimetable; projectedSlots: number }> {
  const timetable = await fetchMasterTimetableById(timetableId, client)
  if (!timetable) throw new Error(`Master timetable #${timetableId} not found`)

  const { error: pubErr } = await client
    .from('master_timetables')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
    })
    .eq('id', timetableId)

  if (pubErr) throw pubErr

  // Project into operational timetable_slots table
  const { projectedCount } = await syncMasterTimetableToSlots(
    timetableId,
    timetable.periods || [],
    timetable.columns || [],
    timetable.entries || [],
    client
  )

  const refreshed = await fetchMasterTimetableById(timetableId, client)
  return {
    timetable: refreshed!,
    projectedSlots: projectedCount,
  }
}

/**
 * Duplicate an existing published timetable into a new draft with incremented version.
 * Ensures previous published versions remain immutable.
 */
export async function duplicateAsNewVersion(
  sourceTimetableId: number,
  client: any = supabase,
  userProfileId?: string
): Promise<MasterTimetable> {
  const source = await fetchMasterTimetableById(sourceTimetableId, client)
  if (!source) throw new Error(`Source master timetable #${sourceTimetableId} not found`)

  const nextVersion = (source.version || 1) + 1
  const draftInput: MasterTimetableDraftInput = {
    title: `${source.title} (v${nextVersion})`,
    academic_year: source.academic_year,
    semester: source.semester,
    cohort: source.cohort,
    effective_date: source.effective_date,
    status: 'draft',
    version: nextVersion,
    header_title: source.header_title,
    header_subtitle: source.header_subtitle,
    footer_notes: source.footer_notes,
    periods: source.periods || [],
    columns: source.columns || [],
    entries: source.entries || [],
  }

  return saveMasterTimetableDraft(draftInput, client, userProfileId)
}
