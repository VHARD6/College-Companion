-- Sample data for development testing
-- Run AFTER the migrations and AFTER creating auth users manually in Supabase dashboard
-- Replace the UUIDs below with real auth user UUIDs from your project

-- Sample department
INSERT INTO departments (name) VALUES ('Computer Science');

-- Sample class: CS-A, Semester 5, 2024-25
INSERT INTO classes (department_id, name, semester, academic_year)
VALUES (1, 'CS-A', 5, '2024-25');

-- Sample batches for practicals
INSERT INTO batches (class_id, name) VALUES (1, 'Batch 1'), (1, 'Batch 2');

-- Sample subjects
INSERT INTO subjects (name, code, department_id, semester, type) VALUES
  ('Operating Systems', 'CS501', 1, 5, 'theory'),
  ('Database Management', 'CS502', 1, 5, 'theory'),
  ('OS Lab', 'CS511', 1, 5, 'practical');
