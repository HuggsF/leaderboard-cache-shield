import { InvalidCourseNameError } from '@domain/errors/invalid-course-name.error';
import { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import { InvalidRankError } from '@domain/errors/invalid-rank.error';
import { InvalidScoreError } from '@domain/errors/invalid-score.error';
import { InvalidStudentNameError } from '@domain/errors/invalid-student-name.error';
import { CourseName } from '@domain/value-objects/course-name.value-object';
import { PageRequest } from '@domain/value-objects/page-request.value-object';
import { Rank } from '@domain/value-objects/rank.value-object';
import { Score } from '@domain/value-objects/score.value-object';
import { StudentName } from '@domain/value-objects/student-name.value-object';

describe('Score', () => {
  it.each([0, 1, 5_000, 10_000])('accepts the integer %p', (value) => {
    const result = Score.create(value);

    expect(result.success && result.data.value).toBe(value);
  });

  it.each([
    [-1, 'between 0 and 10000'],
    [10_001, 'between 0 and 10000'],
    [12.5, 'must be an integer'],
    [Number.NaN, 'must be an integer'],
    [Number.POSITIVE_INFINITY, 'must be an integer'],
  ])('rejects %p (%s)', (value, reason) => {
    const result = Score.create(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidScoreError);
      expect(result.error.code).toBe('INVALID_SCORE');
      expect(result.error.field).toBe('totalScore');
      expect(result.error.message).toContain(reason);
    }
  });

  it('compares by value and is immutable', () => {
    const a = Score.create(700);
    const b = Score.create(700);
    const c = Score.create(800);
    if (!a.success || !b.success || !c.success) throw new Error('fixture');

    expect(a.data.equals(b.data)).toBe(true);
    expect(c.data.isGreaterThan(a.data)).toBe(true);
    expect(a.data.isGreaterThan(c.data)).toBe(false);
    expect(Object.isFrozen(a.data)).toBe(true);
  });
});

describe('Rank', () => {
  it('accepts positive integers', () => {
    const result = Rank.create(1);

    expect(result.success && result.data.value).toBe(1);
  });

  it.each([
    [0, 'positive'],
    [-3, 'positive'],
    [1.5, 'integer'],
    [Number.MAX_SAFE_INTEGER + 2, 'integer'],
  ])('rejects %p', (value, reason) => {
    const result = Rank.create(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidRankError);
      expect(result.error.message).toContain(reason);
    }
  });

  it('knows which rank is ahead (lower is better)', () => {
    const first = Rank.create(1);
    const second = Rank.create(2);
    if (!first.success || !second.success) throw new Error('fixture');

    expect(first.data.isAhead(second.data)).toBe(true);
    expect(second.data.isAhead(first.data)).toBe(false);
    expect(first.data.equals(second.data)).toBe(false);
  });
});

describe('StudentName', () => {
  it('normalises whitespace', () => {
    const result = StudentName.create('  Ana \t  Souza  ');

    expect(result.success && result.data.value).toBe('Ana Souza');
    expect(result.success && result.data.toString()).toBe('Ana Souza');
  });

  it('counts characters, not UTF-16 units', () => {
    const result = StudentName.create(`${'é'.repeat(99)}😀`);

    expect(result.success).toBe(true);
  });

  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['A', 'between 2 and 100'],
    ['x'.repeat(101), 'between 2 and 100'],
  ])('rejects %p', (value, reason) => {
    const result = StudentName.create(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidStudentNameError);
      expect(result.error.message).toContain(reason);
    }
  });

  it('compares by value', () => {
    const a = StudentName.create('Ana Souza');
    const b = StudentName.create('Ana  Souza');
    if (!a.success || !b.success) throw new Error('fixture');

    expect(a.data.equals(b.data)).toBe(true);
  });
});

describe('CourseName', () => {
  it('accepts 2 to 200 characters', () => {
    expect(CourseName.create('JS').success).toBe(true);
    expect(CourseName.create('x'.repeat(200)).success).toBe(true);
  });

  it.each([
    ['', 'required'],
    ['C', 'between 2 and 200'],
    ['x'.repeat(201), 'between 2 and 200'],
  ])('rejects %p', (value, reason) => {
    const result = CourseName.create(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidCourseNameError);
      expect(result.error.message).toContain(reason);
    }
  });

  it('compares by value', () => {
    const a = CourseName.create('Data Structures');
    const b = CourseName.create(' Data Structures ');
    if (!a.success || !b.success) throw new Error('fixture');

    expect(a.data.equals(b.data)).toBe(true);
    expect(a.data.toString()).toBe('Data Structures');
  });
});

describe('PageRequest', () => {
  it('computes the offset of the page', () => {
    const result = PageRequest.create(3, 50);

    expect(result.success && result.data.offset).toBe(100);
  });

  it.each([
    [0, 50, 'page'],
    [1.5, 50, 'page'],
    [PageRequest.MAX_PAGE + 1, 50, 'page'],
    [1, 0, 'pageSize'],
    [1, PageRequest.MAX_PAGE_SIZE + 1, 'pageSize'],
  ])('rejects page=%p pageSize=%p', (page, pageSize, field) => {
    const result = PageRequest.create(page, pageSize);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidPageRequestError);
      expect(result.error.code).toBe('INVALID_PAGE_REQUEST');
      expect(result.error.field).toBe(field);
    }
  });

  it('compares by value', () => {
    const a = PageRequest.create(2, 10);
    const b = PageRequest.create(2, 10);
    const c = PageRequest.create(2, 20);
    if (!a.success || !b.success || !c.success) throw new Error('fixture');

    expect(a.data.equals(b.data)).toBe(true);
    expect(a.data.equals(c.data)).toBe(false);
  });
});
